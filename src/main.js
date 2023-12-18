const IQGeoVSCode = require("./iqgeo-vscode");

function activate(context) {
    const iqgeoVSCode = new IQGeoVSCode(context);
    iqgeoVSCode.onActivation();
}

module.exports = {
    activate
};
