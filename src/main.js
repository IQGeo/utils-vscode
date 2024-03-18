const IQGeoVSCode = require("./iqgeo-vscode");
const IQGeoLayout = require("./iqgeo-layout");
const IQGeoProjectUpdate = require('./iqgeo-project-update');

let iqgeoVSCode;

function activate(context) {
    iqgeoVSCode = new IQGeoVSCode(context);
    new IQGeoLayout(context);
    new IQGeoProjectUpdate(context);
    iqgeoVSCode.onActivation();
}

function deactivate() {
    iqgeoVSCode.onDeactivation();
}

module.exports = {
    activate,
    deactivate
};
