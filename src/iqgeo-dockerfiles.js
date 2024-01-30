const vscode = require('vscode'); // eslint-disable-line
const fs = require('fs');
const path = require('path');
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
        const root =workspaceFolders[0].uri.fsPath;

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
            return;
        }

        vscode.window.showInformationMessage('IQGeo project configured successfully!');
    }

    _readConfig(root) {
        const configFilePath = path.join(root, '.iqgeorc.json');
        const configFile = fs.readFileSync(configFilePath, 'utf8');
        const config = JSON.parse(configFile);
        if (!config.registry) config.registry = 'harbor.delivery.iqgeo.cloud/injectors';
        for (const module of config.required_modules) {
            if (module.version && !module.shortVersion)
                module.shortVersion = module.version.replaceAll('.', '');
        }
        config.project_modules = config.project_modules.map((name) => ({ name, devSrc: name }));
        return config
    }

    _updateFiles(root, config) {
        const update = fileUpdater(root, config);

        update('.devcontainer/dockerfile', (config, content) => {
            const { registry, required_modules, platform } = config;
            const newContent = required_modules
                .map(
                    ({ name, shortVersion }) =>
                        `COPY --link --from=${registry}/${name}:${shortVersion} / \${MODULES}/`
                )
                .join('\n');
            content = content.replace(
                /(# START SECTION.*)[\s\S]*?(# END SECTION)/,
                `$1\n${newContent}\n$2`
            );
            content = content.replace(/platform-devenv:.*/, `platform-devenv:${platform}`);
            return content;
        });

        update('.devcontainer/docker-compose.yml', (config, content) => {
            const { project_modules, required_modules, prefix, db_name } = config;
            const localModules = project_modules
                .concat(required_modules)
                .filter((def) => def.devSrc);
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
            content = content.replace(/iqgeo_devserver:/, `iqgeo_${prefix}_devserver:`)
            return content;
        });

        
        update('.devcontainer/.env.example', (config, content) => {
            const { prefix, db_name } = config;
            content = content.replace(`PROJ_PREFIX=myproj`, `PROJ_PREFIX=${prefix}`);
            content = content.replace(`MYW_DB_NAME=dev_db`, `MYW_DB_NAME=${db_name}`);
            return content;
        });

        update('.devcontainer/devcontainer.json', (config, content) => {
            const { prefix, display_name } = config;
            content = content.replace(`"name": "IQGeo Module Development Template"`, `"name": "${display_name}"`);
            content = content.replace(`"service": "iqgeo_devserver"`, `"service": "iqgeo_${prefix}_devserver"`);
            return content;
        });


        update('deployment/dockerfile.build', (config, content) => {
            const { registry, project_modules, required_modules, platform } = config;
            content = content.replace(/platform-build:\S+/g, `platform-build:${platform}`);
            const newContent = required_modules
                .map(
                    ({ name, shortVersion }) =>
                        `COPY --link --from=${registry}/${name}:${shortVersion} / \${MODULES}/`
                )
                .concat(project_modules.map(({name}) => `COPY --link /${name} \${MODULES}/`))
                .join('\n');
            return content.replace(
                /(# START SECTION.*)[\s\S]*?(# END SECTION)/,
                `$1\n${newContent}\n$2`
            );
        });

        update('deployment/dockerfile.appserver', (config, content) => {
            const { project_modules, required_modules, platform } = config;
            content = content.replace(/platform-appserver:\S+/g, `platform-appserver:${platform}`);

            const newContent = project_modules
                .concat(required_modules)
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
            return content.replace(
                /(# START SECTION.*)[\s\S]*?(# END SECTION)/,
                `$1\n${newContent}\n$2`
            );
        });

        update('deployment/dockerfile.tools', (config, content) => {
            const {  platform } = config;
            content = content.replace(/platform-tools:\S+/g, `platform-tools:${platform}`);
            return content;
        });


        update('deployment/.env.example', (config, content) => {
            const { prefix, db_name } = config;
            content = content.replace(`PROJ_PREFIX=myproj`, `PROJ_PREFIX=${prefix}`);
            content = content.replace(`MYW_DB_NAME=myproj`, `MYW_DB_NAME=${db_name}`);
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

module.exports = IQGeoDockerfiles;
