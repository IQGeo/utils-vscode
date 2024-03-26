const vscode = require('vscode'); // eslint-disable-line
const fs = require('fs');
const path = require('path');
const Utils = require('./utils');

const CLIENT_DEBUG_TYPES = [
    'chrome',
    'pwa-chrome',
    'msedge',
    'pwa-msedge',
    'vscode-edge-devtools.debug',
];

/**
 * The IQGeoWatch class is responsible for starting the webpack watch and restarting the client debug session when a file is saved.
 */
class IQGeoWatch {
    constructor(iqgeoVSCode, context) {
        this.iqgeoVSCode = iqgeoVSCode;

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.startWatch', () => this.start())
        );

        vscode.workspace.onDidSaveTextDocument((doc) => {
            this._restartApp(doc);
        });

        vscode.window.onDidCloseTerminal((t) => {
            if (t === this.watchTerminal) {
                this.watchTerminal = undefined;
            } else if (t === this.apacheTerminal) {
                this.apacheTerminal = undefined;
            }
        });
    }

    /**
     * Creates the watch terminal and starts the webpack build watch.
     * @return {undefined}
     */
    start() {
        if (!vscode.workspace.getConfiguration('iqgeo-utils-vscode').enableAutoRestart) return;

        const workspaceFolder = this.iqgeoVSCode.getWorkspaceFolder();

        if (!this._hasWatchTerminal()) {
            let commandText = vscode.workspace.getConfiguration('iqgeo-utils-vscode').watchCommand;

            if (!commandText) {
                const isPlatform = fs.existsSync(`${workspaceFolder}/WebApps/myworldapp`);
                // 'export BUILD=applications,config,native,tests; cd /opt/iqgeo/platform/WebApps/myworldapp; npx webpack --config webpack.config.js --watch'
                // `export BUILD=base,config,client,applications,native,tests; cd ${workspaceFolder}/WebApps/myworldapp; npx webpack --config webpack.config.js --watch`
                commandText = isPlatform
                    ? 'myw_product watch core_dev --debug'
                    : 'myw_product watch applications_dev --debug';
            }

            this.watchTerminal = vscode.window.createTerminal({
                name: 'IQGeo Watch',
                cwd: workspaceFolder,
            });
            this.watchTerminal.sendText(commandText, true);
        }

        if (
            !this._hasApacheTerminal() &&
            fs.existsSync('/opt/iqgeo/platform/WebApps/myworldapp.wsgi')
        ) {
            this.apacheTerminal = vscode.window.createTerminal({
                name: 'Apache Restart',
                cwd: workspaceFolder,
            });
        }
    }

    /**
     * Closes the watch terminal and the apache terminal if they are running.
     * @return {undefined}
     */
    stop() {
        if (this._hasWatchTerminal()) {
            this.watchTerminal.dispose();
            this.watchTerminal = undefined;
        }
        if (this._hasApacheTerminal()) {
            this.apacheTerminal.dispose();
            this.apacheTerminal = undefined;
        }
    }

    async _restartApp(doc) {
        if (!vscode.workspace.getConfiguration('iqgeo-utils-vscode').enableAutoRestart) return;

        const ext = path.extname(doc.fileName);

        if (ext === '.js') {
            if (
                this._hasWatchTerminal() &&
                vscode.debug.activeDebugSession &&
                CLIENT_DEBUG_TYPES.includes(vscode.debug.activeDebugSession.type)
            ) {
                const restartDelay =
                    vscode.workspace.getConfiguration('iqgeo-utils-vscode').restartDelay ?? 1500;
                await Utils.wait(restartDelay);
                await vscode.commands.executeCommand('workbench.action.debug.restart');
            }
        } else if (
            ext === '.py' &&
            this._hasApacheTerminal() &&
            fs.existsSync('/opt/iqgeo/platform/WebApps/myworldapp.wsgi')
        ) {
            // 'apachectl -k restart'
            this.apacheTerminal.sendText('touch /opt/iqgeo/platform/WebApps/myworldapp.wsgi', true);
        }
    }

    _hasWatchTerminal() {
        if (this.watchTerminal && this.watchTerminal.exitStatus !== undefined) {
            this.watchTerminal = undefined;
        }
        return !!this.watchTerminal;
    }

    _hasApacheTerminal() {
        if (this.apacheTerminal && this.apacheTerminal.exitStatus !== undefined) {
            this.apacheTerminal = undefined;
        }
        return !!this.apacheTerminal;
    }
}

module.exports = IQGeoWatch;
