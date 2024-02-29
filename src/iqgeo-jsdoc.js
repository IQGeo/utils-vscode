const vscode = require('vscode'); // eslint-disable-line
const Utils = require('./utils');

class IQGeoJSDoc {
    constructor(iqgeoVSCode, context) {
        this.iqgeoVSCode = iqgeoVSCode;

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.addJSDoc', () => this._addJSDocTemplate())
        );
    }

    async _addJSDocTemplate() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const doc = editor.document;
        if (doc.languageId !== 'javascript') return;

        this.iqgeoVSCode.updateClassesForDoc(doc, true);

        const sortedSymbols = this.iqgeoVSCode.getSymbolsForFile(doc.fileName);
        const line = editor.selection.active.line;

        const currentSym = sortedSymbols.find((sym) => {
            const symLine = sym.location.range.start.line;
            return symLine === line || symLine - 1 === line;
        });
        if (!currentSym) return;

        const symLine = currentSym.location.range.start.line;
        const kind = currentSym.kind;
        let docLines;
        let templateStr;

        if (kind === vscode.SymbolKind.Class) {
            docLines = Utils.getDocLines(doc);
            const indent = docLines[symLine].match(/^\s*/)[0];
            const className = currentSym._className;

            templateStr = `\n${indent}/**\n${indent} * ${className}\n`;

            for (const parentClass of this.iqgeoVSCode.getParents(className, 'javascript')) {
                templateStr += `${indent} * @extends ${parentClass}\n`;
            }

            templateStr += `${indent} */`;
        } else if (
            [
                vscode.SymbolKind.Function,
                vscode.SymbolKind.Method,
                vscode.SymbolKind.Property,
            ].includes(kind)
        ) {
            docLines = Utils.getDocLines(doc);
            const params = this._getParamsForSymbol(currentSym, docLines);
            const indent = docLines[symLine].match(/^\s*/)[0];

            templateStr = `\n${indent}/**\n${indent} *\n`;

            params.forEach((name) => {
                templateStr += `${indent} * @param {} ${name} - \n`;
            });

            if (currentSym._methodName !== 'constructor()') {
                templateStr += `${indent} * @return {}\n`;
            }

            templateStr += `${indent} */`;
        }

        if (templateStr) {
            const edit = new vscode.WorkspaceEdit();
            const col = docLines[symLine - 1].length;
            const insertPos = new vscode.Position(symLine - 1, col);
            edit.insert(doc.uri, insertPos, templateStr);
            await vscode.workspace.applyEdit(edit);
        }
    }

    _getParamsForSymbol(sym, fileLines) {
        const symLine = sym.location.range.start.line;
        const length = Math.min(symLine + 16, fileLines.length);
        const paramReg = /(?:\((.*?)\)\s+(?:\{|=>)|(\w+)\s*=>)/
        const paramNames = [];

        const addParams = (str, prefix = '') => {
            const reg = /\s*(\{.*?\}|\w+\s*=\s*(".*?"|'.*?'|\[.*?\]|\{.*?\}|\w+)|\w+)(,|\s*$)/g;
            let match;

            while ((match = reg.exec(str))) {
                const paramStr = match[1].trim();
                if (paramStr.startsWith('{')) {
                    const newStr = paramStr.slice(1, -1);
                    paramNames.push(`${prefix}props`);
                    addParams(newStr, `${prefix}props.`);
                } else {
                    const parts = paramStr.split('=');
                    const name = parts[0].trim();
                    if (name.startsWith('...')) {
                        paramNames.push(`${prefix}${name.slice(3)}`);
                    } else if (parts.length > 1) {
                        paramNames.push(`[${prefix}${name}=${parts[1].trim()}]`);
                    } else {
                        paramNames.push(`${prefix}${name}`);
                    }
                }
            }
        };

        let testStr = '';
        for (let i = symLine; i < length; i++) {
            testStr += fileLines[i];

            const paramMatch = testStr.match(paramReg);
            if (paramMatch) {
                addParams(paramMatch[1] ?? paramMatch[2]);
                break;
            }
        }

        return paramNames;
    }
}

module.exports = IQGeoJSDoc;
