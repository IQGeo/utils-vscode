import vscode from 'vscode'; // eslint-disable-line

import { pull, update } from 'project-update';

/**
 * Updates a IQGeo project.
 * Project structure should as per https://github.com/IQGeo/utils-project-template with a .iqgeorc.jsonc configuration file
 */
export class IQGeoProjectUpdate {
    constructor(context) {
        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.updateProject', () => this._update()),
            vscode.commands.registerCommand('iqgeo.pullTemplate', () => this._pull())
        );
    }

    async _update() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const root = workspaceFolders[0].uri.fsPath;

        update({
            root,
            progress: {
                log: (level, info) => vscode.window.showInformationMessage(info),
                warn: (level, info) => vscode.window.showWarningMessage(info),
                error: (level, info) => vscode.window.showErrorMessage(info),
            },
        });
    }

    async _pull() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const out = workspaceFolders[0].uri.fsPath;

        pull({
            out,
            progress: {
                // TODO: handle different log levels?
                log: (level, info) => vscode.window.showInformationMessage(info),
                warn: (level, info) => vscode.window.showWarningMessage(info),
                error: (level, info) => vscode.window.showErrorMessage(info),
            },
        });
    }
}
