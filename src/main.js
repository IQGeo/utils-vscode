import { IQGeoVSCode } from './iqgeo-vscode';
import { IQGeoLayout } from './iqgeo-layout';
import { IQGeoProjectUpdate } from './iqgeo-project-update';

let iqgeoVSCode;

export function activate(context) {
    iqgeoVSCode = new IQGeoVSCode(context);
    new IQGeoLayout(context);
    new IQGeoProjectUpdate(context);
    iqgeoVSCode.onActivation();
}

export function deactivate() {
    iqgeoVSCode.onDeactivation();
}
