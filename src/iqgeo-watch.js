import vscode from 'vscode'; // eslint-disable-line
import fs from 'fs';
import path from 'path';
import Utils from './utils';

const JS_TERMINAL_NAME = 'JS Watch';
const PYTHON_TERMINAL_NAME = 'Python Restart';

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
    constructor(iqgeoVSCode) {
        this.iqgeoVSCode = iqgeoVSCode;

        const config = vscode.workspace.getConfiguration('iqgeo-utils-vscode');
        this.enableAutoRestart = config.enableAutoRestart;

        vscode.workspace.onDidChangeConfiguration((changeEvent) => {
            if (changeEvent.affectsConfiguration('iqgeo-utils-vscode')) {
                const config = vscode.workspace.getConfiguration('iqgeo-utils-vscode');

                if (this.enableAutoRestart !== config.enableAutoRestart) {
                    this.enableAutoRestart = config.enableAutoRestart;

                    if (config.enableAutoRestart) {
                        this.activate();
                    } else {
                        this.deactivate();
                    }
                }
            }
        });

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
    activate() {
        this.runningInContainer = fs.existsSync(`/opt/iqgeo/platform/WebApps/myworldapp.wsgi`);
        if (!this.enableAutoRestart || !this.runningInContainer) return;

        this.workspaceFolder = this.iqgeoVSCode.getWorkspaceFolders()[0];

        if (!this._hasJSTerminal()) {
            this.jsTerminal =
                this._getTerminal(JS_TERMINAL_NAME) ??
                vscode.window.createTerminal({
                    name: JS_TERMINAL_NAME,
                    cwd: this.workspaceFolder,
                });
        }
        this.jsTerminal.sendText(this._getJSWatchCommand(), true);

        if (!this._hasPythonTerminal()) {
            this.pythonTerminal =
                this._getTerminal(PYTHON_TERMINAL_NAME) ??
                vscode.window.createTerminal({
                    name: PYTHON_TERMINAL_NAME,
                    cwd: this.workspaceFolder,
                });
        }
    }

    /**
     * Closes the JS watch terminal and the Python terminal if they are running.
     * @return {undefined}
     */
    deactivate() {
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
        if (!this.enableAutoRestart || !this.runningInContainer) return;

        const ext = path.extname(doc.fileName);

        if (ext === '.js') {
            if (
                !/\.(test|spec)\.js$/.test(doc.fileName) &&
                this._hasJSTerminal() &&
                vscode.debug.activeDebugSession &&
                CLIENT_DEBUG_TYPES.includes(vscode.debug.activeDebugSession.type)
            ) {
                const restartDelay =
                    vscode.workspace.getConfiguration('iqgeo-utils-vscode').restartDelay ?? 1500;
                await Utils.wait(restartDelay);
                await vscode.commands.executeCommand('workbench.action.debug.restart');
            }
        } else if (ext === '.py' && this._hasPythonTerminal()) {
            this.pythonTerminal.sendText(this._getPythonRestartCommand(), true);
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

    _getTerminal(terminalName) {
        for (const terminal of vscode.window.terminals) {
            if (terminal.name === terminalName && terminal.exitStatus === undefined) {
                return terminal;
            }
        }
    }

    _getJSWatchCommand() {
        let commandText = vscode.workspace.getConfiguration('iqgeo-utils-vscode').watchCommand;
        if (!commandText) {
            const isPlatform = fs.existsSync(`${this.workspaceFolder}/WebApps/myworldapp`);
            // 'export BUILD=applications,config,native,tests; cd /opt/iqgeo/platform/WebApps/myworldapp; npx webpack --config webpack.config.js --watch'
            // `export BUILD=base,config,client,applications,native,tests; cd ${workspaceFolder}/WebApps/myworldapp; npx webpack --config webpack.config.js --watch`
            commandText = isPlatform
                ? 'myw_product watch core_dev --debug'
                : 'myw_product watch applications_dev --debug';
        }
        return commandText;
    }

    _getPythonRestartCommand() {
        const commandText =
            vscode.workspace.getConfiguration('iqgeo-utils-vscode').pythonRestartCommand;
        return commandText || 'touch /opt/iqgeo/platform/WebApps/myworldapp.wsgi';
    }
}
