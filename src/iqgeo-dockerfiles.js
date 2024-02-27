const vscode = require('vscode'); // eslint-disable-line
const fs = require('fs');
const path = require('path');

const aptGetMappings = {
    memcached: ['libmemcached-dev'],
    ldap: ['libsasl2-dev', 'libldap2-dev'],
    saml: ['libxml2-dev', 'libxmlsec1-dev'],
};

/**
 *
 */
class IQGeoDockerfiles {
    constructor(iqgeoVSCode) {
        this.iqgeoVSCode = iqgeoVSCode;
    }

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
            this._updateFiles(root, config);
        } catch (e) {
            vscode.window.showErrorMessage('Failed to update files');
            console.error(e);
            return;
        }

        vscode.window.showInformationMessage('IQGeo project configured successfully!');
    }

    _readConfig(root) {
        const configFilePath = path.join(root, '.iqgeorc.json');
        const configFile = fs.readFileSync(configFilePath, 'utf8');
        const config = JSON.parse(configFile);
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

        update('.devcontainer/dockerfile', (config, content) => {
            const { modules, platform } = config;

            replaceModuleInjection(content, modules, ({ version }) => !!version);

            content = content.replace(/platform-devenv:.*/, `platform-devenv:${platform.version}`);
            return content;
        });

        update('.devcontainer/docker-compose.yml', (config, content) => {
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
        });

        update('.devcontainer/.env.example', (config, content) => {
            const { prefix, db_name } = config;
            content = content.replace(`PROJ_PREFIX=myproj`, `PROJ_PREFIX=${prefix}`);
            content = content.replace(
                `COMPOSE_PROJECT_NAME=myproj_dev\n`,
                `COMPOSE_PROJECT_NAME=${prefix}_dev\n`
            );
            content = content.replace(`MYW_DB_NAME=dev_db\n`, `MYW_DB_NAME=${db_name}\n`);
            return content;
        });

        update('.devcontainer/devcontainer.json', (config, content) => {
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
        });

        update('deployment/dockerfile.build', (config, content) => {
            const { modules, platform } = config;
            content = replaceModuleInjection(content, modules, ({ version, devOnly }) => version && !devOnly);
            content = content.replace(/platform-build:\S+/g, `platform-build:${platform.version}`);
            return content;
        });

        update('deployment/dockerfile.appserver', (config, content) => {
            const { modules, platform } = config;

            let aptGets = platform.appserver
                .map((name) => aptGetMappings[name] ?? [])
                .flat()
                .join(' ');
            const section1 = aptGets
                ? `RUN apt-get update && \\\n    apt-get install -y ${aptGets} \\\n    && apt-get autoremove && apt-get clean\n\n` +
                  `RUN myw_product fetch pip_packages --include ${platform.appserver.join(' ')}`
                : '';

            content = content.replace(
                /(# START SECTION optional dependencies.*)[\s\S]*?(# END SECTION)/,
                `$1\n${section1}\n$2`
            );

            content = content.replace(
                /platform-appserver:\S+/g,
                `platform-appserver:${platform.version}`
            );

            const section2 = modules
                .filter(({ devOnly }) => !devOnly)
                .map(({ name }) =>
                    ['__init__.py', 'version_info.json', 'server/', 'public/']
                        .map(
                            (path) =>
                                `COPY --chown=www-data:www-data --from=iqgeo_builder \${MODULES}/${name}/${path} \${MODULES}/${name}/${
                                    path.endsWith('/') ? path : ''
                                }`
                        )
                        .join('\n')
                )
                .join('\n');
            content = content.replace(
                /(# START SECTION Copy modules.*)[\s\S]*?(# END SECTION)/,
                `$1\n${section2}\n$2`
            );
            return content;
        });

        update('deployment/dockerfile.tools', (config, content) => {
            const { platform } = config;
            content = content.replace(/platform-tools:\S+/g, `platform-tools:${platform.version}`);
            return content;
        });

        update('deployment/.env.example', (config, content) => {
            const { prefix, db_name } = config;
            content = content.replace(`PROJ_PREFIX=myproj\n`, `PROJ_PREFIX=${prefix}\n`);
            content = content.replace(`MYW_DB_NAME=myproj\n`, `MYW_DB_NAME=${db_name}\n`);
            return content;
        });
    }
}

function fileUpdater(root, config) {
    return (relPath, transform) => {
        const filePath = path.join(root, relPath);
        let content = fs.readFileSync(filePath, 'utf8');
        content = transform(config, content);
        if (!content) throw new Error('transform returned empty content');
        fs.writeFileSync(filePath, content);
    };
}

function replaceModuleInjection(content, modules, includefn) {
    const section1 = modules
        .filter(includefn)
        .map(({ name, version }) => `FROM \${CONTAINER_REGISTRY}${name}:${version} as ${name}`)
        .join('\n');
    content = content.replace(
        /(# START SECTION Injector aliases.*)[\s\S]*?(# END SECTION)/,
        `$1\n${section1}\n$2`
    );
    const section2 = modules
        .filter(({ devOnly }) => !devOnly)
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

module.exports = IQGeoDockerfiles;
