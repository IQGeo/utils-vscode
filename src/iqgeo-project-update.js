// @ts-check
import vscode from 'vscode'; // eslint-disable-line
import util from 'util';

import { pull, update } from 'project-update';

import utils from './utils';

/**
 * @param {(msg: string, items?: string) => Thenable<string | undefined>} notificationCb
 * @param {(msg: string) => void} outputCb
 * @returns {ProgressHandler[keyof ProgressHandler]}
 */
function getProgressMethod(notificationCb, outputCb) {
    return (level, info, moreDetails) => {
        if (moreDetails) {
            if (level === 1) {
                utils.showMessageWithDetails(notificationCb, info);
            }

            outputCb(util.format(info));
            outputCb(util.format(moreDetails));
        } else {
            if (level === 1) {
                notificationCb(info);
            }

            outputCb(util.format(info));
        }
    };
}

/**
 * Updates a IQGeo project.
 * Project structure should as per https://github.com/IQGeo/utils-project-template with a .iqgeorc.jsonc configuration file
 */
export class IQGeoProjectUpdate {
    /** @param {vscode.LogOutputChannel} outputChannel */
    constructor(context, outputChannel) {
        /** @type {ProgressHandler} */
        this._progressHandler = {
            log: getProgressMethod(vscode.window.showInformationMessage, outputChannel.info),
            warn: getProgressMethod(vscode.window.showWarningMessage, outputChannel.warn),
            error: getProgressMethod(vscode.window.showErrorMessage, outputChannel.error),
        };

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
            progress: this._progressHandler,
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
                    progress: this._progressHandler,
                });
            }
        );
    }
}

/**
 * @typedef {import('project-update').ProgressHandler} ProgressHandler
 */
