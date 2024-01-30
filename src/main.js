const IQGeoVSCode = require("./iqgeo-vscode");
const IQGeoLayout = require("./iqgeo-layout");

function activate(context) {
    const iqgeoVSCode = new IQGeoVSCode(context);
    new IQGeoLayout(context);
    iqgeoVSCode.onActivation();
}

module.exports = {
    activate
};
