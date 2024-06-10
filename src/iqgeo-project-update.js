import vscode from 'vscode'; // eslint-disable-line

import { pull, update } from 'project-update';

/**
 * Updates a IQGeo project.
 * Project structure should as per https://github.com/IQGeo/utils-project-template with a .iqgeorc.jsonc configuration file
 */
export class IQGeoProjectUpdate {
    /** @param {vscode.OutputChannel} outputChannel */
    constructor(context, outputChannel) {
        this.outputChannel = outputChannel;

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.updateProject', () => this._update()),
            vscode.commands.registerCommand('iqgeo.pullTemplate', () => this._pull())
        );
    }

    _progressHandlers = {
        log: (level, info, moreDetails) => {
            if (moreDetails) {
                vscode.window.showInformationMessage(
                    `${info} ([details](command:iqgeo.showOutput))`
                );

                this.outputChannel.appendLine(moreDetails);
            } else {
                vscode.window.showInformationMessage(info);
            }
        },
        warn: (level, info, moreDetails) => {
            if (moreDetails) {
                vscode.window.showWarningMessage(`${info} ([details](command:iqgeo.showOutput))`);

                this.outputChannel.appendLine(moreDetails);
            } else {
                vscode.window.showWarningMessage(info);
            }
        },
        error: (level, info, moreDetails) => {
            if (moreDetails) {
                vscode.window.showErrorMessage(`${info} ([details](command:iqgeo.showOutput))`);

                this.outputChannel.appendLine(moreDetails);
            } else {
                vscode.window.showErrorMessage(info);
            }
        },
    };

    async _update() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const root = workspaceFolders[0].uri.fsPath;

        update({
            root,
            progress: this._progressHandlers,
        });
    }

    async _pull() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const out = workspaceFolders[0].uri.fsPath;

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Pulling project-template',
            },
            () => {
                return pull({
                    out,
                    progress: this._progressHandlers,
                });
            }
        );
    }
}
