import vscode from 'vscode'; // eslint-disable-line
import util from 'util';

import { pull, update } from 'project-update';

/**
 * Updates a IQGeo project.
 * Project structure should as per https://github.com/IQGeo/utils-project-template with a .iqgeorc.jsonc configuration file
 */
export class IQGeoProjectUpdate {
    /** @param {vscode.LogOutputChannel} outputChannel */
    constructor(context, outputChannel) {
        this.outputChannel = outputChannel;

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.updateProject', () => this._update()),
            vscode.commands.registerCommand('iqgeo.pullTemplate', () => this._pull())
        );
    }

    /** @type {import('project-update').ProgressHandler} */
    _progressHandlers = {
        log: (level, info, moreDetails) => {
            if (moreDetails) {
                vscode.window.showInformationMessage(
                    `${info} ([details](command:iqgeo.showOutput))`
                );

                this.outputChannel.info(util.format(info));
                this.outputChannel.info(util.format(moreDetails));
            } else {
                vscode.window.showInformationMessage(info);
            }
        },
        warn: (level, info, moreDetails) => {
            if (moreDetails) {
                vscode.window.showWarningMessage(`${info} ([details](command:iqgeo.showOutput))`);

                this.outputChannel.warn(util.format(info));
                this.outputChannel.warn(util.format(moreDetails));
            } else {
                vscode.window.showWarningMessage(info);
            }
        },
        error: (level, info, moreDetails) => {
            if (moreDetails) {
                vscode.window.showErrorMessage(`${info} ([details](command:iqgeo.showOutput))`);

                this.outputChannel.error(util.format(info));
                this.outputChannel.error(util.format(moreDetails));
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
