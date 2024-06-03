import vscode from 'vscode'; // eslint-disable-line

import { update } from 'project-update';

/**
 * Updates a IQGeo project.
 * Project structure should as per https://github.com/IQGeo/utils-project-template with a .iqgeorc.jsonc configuration file
 */
export class IQGeoProjectUpdate {
    constructor(context) {
        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.updateProject', () => this._update())
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
}
