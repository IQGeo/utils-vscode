import vscode from 'vscode'; // eslint-disable-line
import Utils from '../utils';

const PYTHON_CLASS_REG = /^\s*class\s+(\w+)(?:\(((?:[\w=]+,?\s*)*?)\))?:/;
const PYTHON_DEF_REG = /^\s+def\s+(\w+)\((.*?)\)(\s+->.*?)?:/;
const PYTHON_DEF_MULTI_LINE_REG = /^\s+def\s+(\w+)\(\s*$/;
const EXPORT_PYTHON_DEF_REG = /^def\s+(\w+)\((.*?)\)(\s+->.*?)?:/;
const EXPORT_PYTHON_DEF_MULTI_LINE_REG = /^def\s+(\w+)\(\s*$/;

export class IQGeoPythonSearch {
    constructor(iqgeoVSCode) {
        this.iqgeoVSCode = iqgeoVSCode;
    }

    updateClasses(fileName, fileLines = undefined) {
        if (!fileLines) {
            fileLines = Utils.getFileLines(fileName);
            if (!fileLines) return;
        }

        if (this.iqgeoVSCode.debug) {
            console.log('Searching ', fileName);
        }

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
                        classMatch[2].split(/,\s*/).filter((p) => !p.includes('=')),
                        'python'
                    );
                }
                classFound = true; // debug flag
            } else {
                if (currentClass) {
                    const [methodName, paramString] = this._findMethodDef(str, line, fileLines);
                    if (methodName) {
                        const index = str.indexOf(methodName) + methodName.length;
                        const name = `${methodName}()`;
                        currentClassData.methods[name] = {
                            name,
                            className: currentClass,
                            fileName,
                            line,
                            index,
                            kind: vscode.SymbolKind.Method,
                            paramString,
                        };
                        symbolCount++; // debug counter
                        continue;
                    }
                }
                const functionName = this._findExportMethodDef(str, line, fileLines);
                if (functionName) {
                    const index = str.indexOf(functionName) + functionName.length;
                    this.iqgeoVSCode.addFunction(functionName, {
                        fileName,
                        line,
                        index,
                        workspace: inWorkspace,
                        languageId: 'python',
                        exported: true,
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

    _findMethodDef(str, line, fileLines) {
        let match = str.match(PYTHON_DEF_REG);
        if (match) {
            return [match[1], match[2]];
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            PYTHON_DEF_MULTI_LINE_REG,
            PYTHON_DEF_REG
        );
        if (match) {
            return [match[1], match[2]];
        }

        return [];
    }

    _findExportMethodDef(str, line, fileLines) {
        let match = str.match(EXPORT_PYTHON_DEF_REG);
        if (match) {
            return match[1];
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            EXPORT_PYTHON_DEF_MULTI_LINE_REG,
            EXPORT_PYTHON_DEF_REG
        );
        if (match) {
            return match[1];
        }
    }
}
