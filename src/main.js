import vscode from 'vscode';

import { IQGeoVSCode } from './iqgeo-vscode';
import { IQGeoLayout } from './iqgeo-layout';
import { IQGeoProjectUpdate } from './iqgeo-project-update';

let iqgeoVSCode;

export function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('IQGeo', { log: true });

    vscode.commands.registerCommand('iqgeo.showOutput', () => {
        outputChannel.show(true);
    });

    iqgeoVSCode = new IQGeoVSCode(context, outputChannel);
    new IQGeoLayout(context);
    new IQGeoProjectUpdate(context, outputChannel);

    iqgeoVSCode.onActivation();
}

export function deactivate() {
    iqgeoVSCode.onDeactivation();
}
