const vscode = require('vscode'); // eslint-disable-line
const fs = require('fs');
const path = require('path');
const jsonc = require('jsonc');

const aptGetMappingsBuild = {
    memcached: ['libmemcached-dev'],
    ldap: ['libsasl2-dev', 'libldap2-dev'],
    saml: ['libxml2-dev', 'libxmlsec1-dev'],
};
const aptGetMappingsRuntime = {
    memcached: ['libmemcached11'],
    ldap: ['libsasl2-dev', 'libldap2-dev'], //ENH: identify the correct runtime packages
    saml: ['libxml2-dev', 'libxmlsec1-dev'], //ENH: identify the correct runtime packages
};

const fileModifications = {
    '.devcontainer/dockerfile': (config, content) => {
        const { modules, platform } = config;

        content = replaceModuleInjection(content, modules, true);

        content = replaceOptionalDeps(platform.devenv, content);
        content = replaceFetchPipPackages(platform.devenv, content);

        content = content.replace(/platform-devenv:.*/, `platform-devenv:${platform.version}`);
        return content;
    },

    '.devcontainer/docker-compose.yml': (config, content) => {
        const { modules, prefix, db_name } = config;
        const localModules = modules.filter((def) => !def.version || def.devSrc);
        const newContent = localModules
            .map(
                ({ name, devSrc }) =>
                    `            - ../${devSrc}:/opt/iqgeo/platform/WebApps/myworldapp/modules/${name}:delegated`
            )
            .join('\n');
        content = content.replace(
            /(# START SECTION.*)[\s\S]*?(.*# END SECTION)/,
            `$1\n${newContent}\n$2`
        );
        content = content.replace(/\${PROJ_PREFIX:-myproj}/g, `\${PROJ_PREFIX:-${prefix}}`);
        content = content.replace(/\${MYW_DB_NAME:-iqgeo}/g, `\${MYW_DB_NAME:-${db_name}}`);
        content = content.replace(/iqgeo_devserver:/, `iqgeo_${prefix}_devserver:`);
        return content;
    },

    '.devcontainer/.env.example': (config, content) => {
        const { prefix, db_name } = config;
        content = content.replace(`PROJ_PREFIX=myproj`, `PROJ_PREFIX=${prefix}`);
        content = content.replace(
            `COMPOSE_PROJECT_NAME=myproj_dev\n`,
            `COMPOSE_PROJECT_NAME=${prefix}_dev\n`
        );
        content = content.replace(`MYW_DB_NAME=dev_db\n`, `MYW_DB_NAME=${db_name}\n`);
        return content;
    },

    '.devcontainer/devcontainer.json': (config, content) => {
        const { prefix, display_name } = config;
        content = content.replace(
            `"name": "IQGeo Module Development Template"`,
            `"name": "${display_name}"`
        );
        content = content.replace(
            `"service": "iqgeo_devserver"`,
            `"service": "iqgeo_${prefix}_devserver"`
        );
        return content;
    },

    'deployment/dockerfile.build': (config, content) => {
        const { modules, platform } = config;
        content = replaceModuleInjection(content, modules);
        content = content.replace(/platform-build:\S+/g, `platform-build:${platform.version}`);
        return content;
    },

    'deployment/dockerfile.appserver': (config, content) => {
        const { modules, platform } = config;

        content = replaceOptionalDeps(platform.appserver, content, 'build');
        content = replaceOptionalDeps(platform.appserver, content, 'runtime');
        content = replaceFetchPipPackages(platform.devenv, content);

        content = content.replace(
            /platform-appserver:\S+/g,
            `platform-appserver:${platform.version}`
        );

        const section2 = modules
            .filter(({ devOnly }) => !devOnly)
            .map(
                ({ name }) =>
                    `COPY --chown=www-data:www-data --from=iqgeo_builder \${MODULES}/${name}/ \${MODULES}/${name}/`
            )
            .join('\n');
        content = content.replace(
            /(# START SECTION Copy modules.*)[\s\S]*?(# END SECTION)/,
            `$1\n${section2}\n$2`
        );
        return content;
    },

    'deployment/dockerfile.tools': (config, content) => {
        const { platform } = config;
        content = content.replace(/platform-tools:\S+/g, `platform-tools:${platform.version}`);
        return content;
    },

    'deployment/docker-compose.yml': (config, content) => {
        const { prefix, db_name } = config;
        content = content.replace(/\${PROJ_PREFIX:-myproj}/g, `\${PROJ_PREFIX:-${prefix}}`);
        content = content.replace(/\${MYW_DB_NAME:-iqgeo}/g, `\${MYW_DB_NAME:-${db_name}}`);
        return content;
    },

    'deployment/.env.example': (config, content) => {
        const { prefix, db_name } = config;
        content = content.replace(`PROJ_PREFIX=myproj\n`, `PROJ_PREFIX=${prefix}\n`);
        content = content.replace(`MYW_DB_NAME=myproj\n`, `MYW_DB_NAME=${db_name}\n`);
        return content;
    },

    'deployment/entrypoint.d/600_init_db.sh': initDbModifier,
    '.devcontainer/entrypoint.d/600_init_db.sh': initDbModifier,
};

/**
 * Updates a IQGeo project.
 * Project structure should as per https://github.com/IQGeo/utils-project-template with a .iqgeorc.jsonc configuration file
 */
class IQGeoProjectUpdate {
    constructor(iqgeoVSCode) {
        this.iqgeoVSCode = iqgeoVSCode;
    }

    /**
     * Updates a IQGeo project based on https://github.com/IQGeo/utils-project-template from the options specified in the .iqgeorc.jsonc configuration file
     */
    async update() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const root = workspaceFolders[0].uri.fsPath;

        let config;
        try {
            config = this._readConfig(root);
        } catch (e) {
            vscode.window.showErrorMessage('Failed to read configuration file');
            return;
        }
        try {
            const allUpdated = this._updateFiles(root, config);
            if (allUpdated)
                vscode.window.showInformationMessage('IQGeo project configured successfully!');
            else vscode.window.showWarningMessage('IQGeo project configured with warnings');
        } catch (e) {
            vscode.window.showErrorMessage('Failed to update files');
            console.error(e);
            return;
        }
    }

    _readConfig(root) {
        const configFilePath = path.join(root, '.iqgeorc.jsonc');
        const configFile = fs.readFileSync(configFilePath, 'utf8');
        const config = jsonc.parse(configFile);
        if (!config.registry) config.registry = 'harbor.delivery.iqgeo.cloud/releases';
        for (const module of config.modules) {
            if (module.version && !module.shortVersion)
                module.shortVersion = module.version.replaceAll('.', '');
            if (!module.version && !module.devSrc) module.devSrc = module.name;
        }
        return config;
    }

    _updateFiles(root, config) {
        const update = fileUpdater(root, config);

        const errors = Object.entries(fileModifications).map(([relPath, transform]) => {
            try {
                return update(relPath, transform);
            } catch (e) {
                console.warn(`Failed to update file ${relPath}`);
                console.error(e);
                return e;
            }
        });
        return !errors.some((e) => e);
    }
}

function fileUpdater(root, config) {
    return (relPath, transform) => {
        const filePath = path.join(root, relPath);
        let content;
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            console.warn(`Failed to read file ${filePath}`);
            return false;
        }
        content = transform(config, content);
        if (!content) throw new Error('transform returned empty content');
        fs.writeFileSync(filePath, content);
    };
}

function initDbModifier(config, content) {
    const { modules } = config;
    const section1 = modules
        .filter(({ version, dbInit = !!version }) => dbInit)
        .map(
            ({ name, schemaGrep = name }) =>
                `if ! myw_db $MYW_DB_NAME list versions | grep ${schemaGrep}; then myw_db $MYW_DB_NAME install ${name}; fi`
        )
        .join('\n');
    content = content.replace(
        /(# START SECTION db init.*)[\s\S]*?(# END SECTION)/,
        `$1\n${section1}\n$2`
    );

    return content;
}

function replaceModuleInjection(content, modules, isDevEnv = false) {
    const isFromInjectorFn = ({ version, devSrc }) => version && !devSrc;
    const filter1 = isDevEnv ? isFromInjectorFn : ({ version }) => !!version;
    const section1 = modules
        .filter(filter1)
        .map(({ name, version }) => `FROM \${CONTAINER_REGISTRY}${name}:${version} as ${name}`)
        .join('\n');
    content = content.replace(
        /(# START SECTION Aliases for Injector images.*)[\s\S]*?(# END SECTION)/,
        `$1\n${section1}\n$2`
    );

    const filter2 = isDevEnv ? isFromInjectorFn : ({ devOnly }) => !devOnly;
    const section2 = modules
        .filter(filter2)
        .map(({ name, version }) =>
            version
                ? `COPY --link --from=${name} / \${MODULES}/`
                : `COPY --link /${name} \${MODULES}/`
        )
        .join('\n');
    content = content.replace(
        /(# START SECTION Copy the modules.*)[\s\S]*?(# END SECTION)/,
        `$1\n${section2}\n$2`
    );
    return content;
}

function replaceOptionalDeps(optionalDeps = [], content, type = 'build') {
    const aptGetMappings = type === 'build' ? aptGetMappingsBuild : aptGetMappingsRuntime;
    let aptGets = optionalDeps
        .map((name) => aptGetMappings[name] ?? [])
        .flat()
        .join(' ');
    const section1 = aptGets
        ? `RUN apt-get update && \\\n    apt-get install -y ${aptGets} \\\n    && apt-get autoremove && apt-get clean`
        : '';
    content = content.replace(
        type === 'build'
            ? /(# START SECTION optional dependencies \(build.*)[\s\S]*?(# END SECTION)/
            : /(# START SECTION optional dependencies \(runtime.*)[\s\S]*?(# END SECTION)/,
        `$1\n${section1}\n$2`
    );

    return content;
}

function replaceFetchPipPackages(optionalDeps = [], content) {
    content = content.replace(
        /(RUN myw_product fetch pip_packages.*)/,
        optionalDeps?.length
            ? `RUN myw_product fetch pip_packages --include ${optionalDeps.join(' ')}`
            : 'RUN myw_product fetch pip_packages',
        content
    );
    return content;
}

module.exports = IQGeoProjectUpdate;
