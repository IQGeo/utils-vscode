import vscode from 'vscode'; // eslint-disable-line
import fs from 'fs';
import path from 'path';
import Utils from './utils';

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
export class IQGeoWatch {
    constructor(iqgeoVSCode, context) {
        this.iqgeoVSCode = iqgeoVSCode;

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.startWatch', () => this.start())
        );

        vscode.workspace.onDidSaveTextDocument((doc) => {
            this._restartApp(doc);
        });

        vscode.window.onDidCloseTerminal((t) => {
            if (t === this.jsTerminal) {
                this.jsTerminal = undefined;
            } else if (t === this.pythonTerminal) {
                this.pythonTerminal = undefined;
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

        if (!this._hasJSTerminal()) {
            let commandText = vscode.workspace.getConfiguration('iqgeo-utils-vscode').watchCommand;

            if (!commandText) {
                const isPlatform = fs.existsSync(`${workspaceFolder}/WebApps/myworldapp`);
                // 'export BUILD=applications,config,native,tests; cd /opt/iqgeo/platform/WebApps/myworldapp; npx webpack --config webpack.config.js --watch'
                // `export BUILD=base,config,client,applications,native,tests; cd ${workspaceFolder}/WebApps/myworldapp; npx webpack --config webpack.config.js --watch`
                commandText = isPlatform
                    ? 'myw_product watch core_dev --debug'
                    : 'myw_product watch applications_dev --debug';
            }

            for (const terminal of vscode.window.terminals) {
                if (terminal.name === 'JS Watch' && terminal.exitStatus === undefined) {
                    this.jsTerminal = terminal;
                    break;
                }
            }

            if (!this.jsTerminal) {
                this.jsTerminal = vscode.window.createTerminal({
                    name: 'JS Watch',
                    cwd: workspaceFolder,
                });
            }

            this.jsTerminal.sendText(commandText, true);
        }

        if (
            !this._hasPythonTerminal() &&
            fs.existsSync('/opt/iqgeo/platform/WebApps/myworldapp.wsgi')
        ) {
            for (const terminal of vscode.window.terminals) {
                if (terminal.name === 'Python Restart' && terminal.exitStatus === undefined) {
                    this.pythonTerminal = terminal;
                    break;
                }
            }

            if (!this.pythonTerminal) {
                this.pythonTerminal = vscode.window.createTerminal({
                    name: 'Python Restart',
                    cwd: workspaceFolder,
                });
            }
        }
    }

    /**
     * Closes the JS watch terminal and the Python terminal if they are running.
     * @return {undefined}
     */
    stop() {
        if (this._hasJSTerminal()) {
            this.jsTerminal.dispose();
            this.jsTerminal = undefined;
        }
        if (this._hasPythonTerminal()) {
            this.pythonTerminal.dispose();
            this.pythonTerminal = undefined;
        }
    }

    async _restartApp(doc) {
        if (!vscode.workspace.getConfiguration('iqgeo-utils-vscode').enableAutoRestart) return;

        const ext = path.extname(doc.fileName);

        if (ext === '.js') {
            if (
                this._hasJSTerminal() &&
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
            this._hasPythonTerminal() &&
            fs.existsSync('/opt/iqgeo/platform/WebApps/myworldapp.wsgi')
        ) {
            // 'apachectl -k restart'
            this.pythonTerminal.sendText('touch /opt/iqgeo/platform/WebApps/myworldapp.wsgi', true);
        }
    }

    _hasJSTerminal() {
        if (this.jsTerminal && this.jsTerminal.exitStatus !== undefined) {
            this.jsTerminal = undefined;
        }
        return !!this.jsTerminal;
    }

    _hasPythonTerminal() {
        if (this.pythonTerminal && this.pythonTerminal.exitStatus !== undefined) {
            this.pythonTerminal = undefined;
        }
        return !!this.pythonTerminal;
    }
}
