const vscode = require('vscode'); // eslint-disable-line
const Utils = require('./utils');

const PYTHON_CLASS_REG = /^\s*class\s+(\w+)(?:\(((?:\w+,?\s*)*?)\))?:/;
const PYTHON_DEF_REG = /^\s+def\s+(\w+)\(.*?\):/;
const EXPORT_PYTHON_DEF_REG = /^def\s+(\w+)\(.*?\):/;

class IQGeoPythonSearch {
    constructor(iqgeoVSCode) {
        this.iqgeoVSCode = iqgeoVSCode;
    }

    updateClasses(fileName) {
        const fileLines = Utils.getFileLines(fileName);
        const len = fileLines.length;
        const inWorkspace = this.iqgeoVSCode.isWorkspaceFile(fileName);
        let classFound = false; // debug flag
        let symbolCount = 0; // debug counter
        let currentClass;
        let currentClassData;

        for (let line = 0; line < len; line++) {
            const str = fileLines[line];
            const classMatch = str.match(PYTHON_CLASS_REG);

            if (classMatch) {
                currentClass = classMatch[1];
                const index = str.indexOf(currentClass) + currentClass.length;
                currentClassData = {
                    fileName,
                    line,
                    index,
                    workspace: inWorkspace,
                    methods: {},
                    languageId: 'python',
                };
                this.iqgeoVSCode.addClassData(currentClass, currentClassData);
                if (classMatch[2]) {
                    this.iqgeoVSCode.addParents(
                        currentClass,
                        classMatch[2].split(/,\s*/),
                        'python'
                    );
                }
                classFound = true; // debug flag
            } else {
                if (currentClass) {
                    const defMatch = str.match(PYTHON_DEF_REG);
                    if (defMatch) {
                        const methodName = defMatch[1];
                        const index = str.indexOf(methodName) + methodName.length;
                        const name = `${methodName}()`;
                        currentClassData.methods[name] = {
                            name,
                            fileName,
                            line,
                            index,
                            kind: vscode.SymbolKind.Method,
                        };
                        symbolCount++; // debug counter
                        continue;
                    }
                }
                const exportMatch = str.match(EXPORT_PYTHON_DEF_REG);
                if (exportMatch) {
                    const functionName = exportMatch[1];
                    const index = str.indexOf(functionName) + functionName.length;
                    this.iqgeoVSCode.addExportedFunction(functionName, {
                        fileName,
                        line,
                        index,
                        workspace: inWorkspace,
                        languageId: 'python',
                    });
                    symbolCount++; // debug counter
                }
            }
        }

        if (this.iqgeoVSCode.debug) {
            if (!classFound && symbolCount === 0) {
                console.log('No class or symbols found in', fileName);
            } else if (!classFound) {
                console.log('No class found in', fileName);
            } else if (symbolCount === 0) {
                console.log('No symbols found in', fileName);
            }
        }
    }
}

module.exports = IQGeoPythonSearch;
