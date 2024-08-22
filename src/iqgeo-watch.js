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
        this.autoRestartEnabled = vscode.workspace.getConfiguration('iqgeo-utils-vscode').enableAutoRestart;
        this.runningInContainer = fs.existsSync(`/opt/iqgeo/platform/WebApps/myworldapp.wsgi`);
        if (!this.autoRestartEnabled || !this.runningInContainer) return;

        this.workspaceFolder = this.iqgeoVSCode.getWorkspaceFolder();

        if (!this._hasJSTerminal()) {
            this.jsTerminal = this._getTerminal("JS Watch") ?? vscode.window.createTerminal({
                name: 'JS Watch',
                cwd: this.workspaceFolder,
            });
        }
        this.jsTerminal.sendText(this._getJSWatchCommand(), true);

        if (!this._hasPythonTerminal()) {
            this.pythonTerminal = this._getTerminal("Python Restart") ?? vscode.window.createTerminal({
                name: 'Python Restart',
                cwd: this.workspaceFolder,
            });
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
        if (!this.autoRestartEnabled || !this.runningInContainer) return;

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
        return commandText
    }

    _getPythonRestartCommand() {
        const commandText = vscode.workspace.getConfiguration('iqgeo-utils-vscode').pythonRestartCommand;
        return commandText || "touch /opt/iqgeo/platform/WebApps/myworldapp.wsgi"
    }
}
