const vscode = require('vscode'); // eslint-disable-line
const Utils = require('../utils');

const EXTEND_REG = /(\w+)\.extend\s*\(\s*['"](\w+)['"]/;
const EXTEND_MULTI_REG = /(\w+)\.extend\s*\(\s*$/;
const EXTEND_NO_STRING_REG = /(\w+)\s*=.*?(\w+)\.extend\s*\((\s*['"]([\w\s]+)['"]\s*,)?\s*{/;
const EXTEND_NO_STRING_MULTI_REG = /(\w+)\s*=.*?(\w+)\.extend\s*\(\s*$/;
const CLASS_REG = /^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)\s+(?:extends)?.*?(\w+)?\s*{/;
const NAMESPACE_CLASS_REG = /(?:\w+)\s*=\s*class\s+(\w+)\s+(?:extends)?.*?(\w+)?\s*\)?\s*{/;
const NAMESPACE_CLASS_MULTI_LINE_REG = /(?:\w+)\s*=\s*class\s+(\w+)\s+(?:extends)\s*\(?/;
const RENAME_CLASS_REG = /^\s*export\s+const\s+(\w+)\s+=\s+\w+;/;
const MIXIN_REG = /(\w+(Mixin)?)\s*=\s*{/;
const EXPORT_MIXIN_REG = /^export\s+(?:(?:default|const)\s+)*(\w+(Mixin)?)\s*=\s*{/;
const CLASS_ASSIGN_REG = /(?:^|\s+)Object\.assign\(.*?(\w+)\.prototype,\s*(\w+)\)/;
const PROPERTY_REG = /^\s*#?(\w+):/;
const SETTER_OR_GETTER_REG = /^\s*(?:(?:set|get)\s+)(\w+)\s*\(/;
const FUNCTION_REG = /^\s*(?:async\s+|static\s+|#)?\*?(\w+)\s*\(([\w,\s={}\[\]'"]|\.{3})*?\)\s*{/;
const FUNCTION_MULTI_LINE_REG = /^\s*(async\s*|static\s*|#)?\*?\w+\s*\(\s*$/;
const CONST_FUNCTION_REG = /^const\s+(\w+)\s*=\s*(?:async\s+)?function\*?\s*\(/;
const CONST_ARROW_FUNCTION_REG = /^const\s+(\w+)\s*=[^;]*?\s+=>\s+/;
const CONST_FUNCTION_MULTI_LINE_REG = /^const\s+(\w+)\s*=\s*\(/;
const NO_CONST_FUNCTION_REG = /^(?:async\s+)?function\*?\s+(\w+)\s*\(/;
const ARROW_FUNCTION_REG = /^\s*(?:async\s*)?(\w+).*?\s+=>\s+{/;
const EXPORT_FUNCTION_REG = /^export\s+(?:(?:default|async)\s+)*function\*?\s+(\w+)\s*\(/;
const EXPORT_ARROW_FUNCTION_REG = /^export\s+(?:(?:default|const)\s+)*(\w+)\s*=\s*[^;]*?\s+=>\s+{/;
const EXPORT_ARROW_FUNCTION_MULTI_LINE_REG = /^export\s+((default|const)\s+)*(\w+)\s*=/;
const EXPORT_FUNCTION_RESULT_REG = /^export\s+(?:(?:default|const)\s+)*(\w+)\s*=\s*.*?(\w+)\s*\(/;
const INCLUDE_MIXIN_REG = /^\s*this.include\(\s*(\w+)\s*\)/;
const LITERAL_BEFORE_QUOTE_REG = /^[^'"]*`/;
const INC_BRACKETS = /(?<!%)[{]/g;
const DEC_BRACKETS = /(?<!%)[}]/g;

class IQGeoJSSearch {
    constructor(iqgeoVSCode) {
        this.iqgeoVSCode = iqgeoVSCode;
    }

    updateClasses(fileName, fileLines = undefined) {
        if (!fileLines) {
            fileLines = Utils.getFileLines(fileName);
            if (!fileLines) return;
        }

        const len = fileLines.length;
        const inWorkspace = this.iqgeoVSCode.isWorkspaceFile(fileName);
        let classFound = false; // debug flag
        let symbolCount = 0; // debug counter
        let classData;
        let currentClass;
        let currentClassData;
        let bracketMatches;
        let indent = 0;
        let inComment = false;
        let inLiteral = false;

        classData = this._findClassDefAssign(fileLines);
        if (classData) {
            currentClass = classData.class;
            currentClassData = {
                fileName,
                line: classData.line,
                index: classData.index,
                workspace: inWorkspace,
                methods: {},
                languageId: 'javascript',
            };
            this.iqgeoVSCode.addClassData(currentClass, currentClassData);
            this.iqgeoVSCode.addParent(currentClass, classData.parent, 'javascript');
            classFound = true; // debug flag
        }

        for (let line = 0; line < len; line++) {
            const str = fileLines[line];
            let testStr = Utils.removeLineComment(str);

            [testStr, inComment] = Utils.removeComments(testStr, inComment);

            if (inLiteral || LITERAL_BEFORE_QUOTE_REG.test(testStr)) {
                [testStr, inLiteral] = Utils.removeLiterals(testStr, inLiteral);
                testStr = Utils.removeStrings(testStr);
            } else {
                testStr = Utils.removeStrings(testStr);
                [testStr, inLiteral] = Utils.removeLiterals(testStr, inLiteral);
            }

            if (indent === 0) {
                const functionName = this._findExportFunctionDef(str, line, fileLines);
                if (functionName) {
                    this.iqgeoVSCode.addExportedFunction(functionName, {
                        fileName,
                        line,
                        index: str.indexOf(functionName) + functionName.length,
                        workspace: inWorkspace,
                        languageId: 'javascript',
                    });
                    symbolCount++; // debug counter
                } else {
                    classData = this._findClassDef(str, line, fileLines);
                    if (classData) {
                        currentClass = classData.class;
                        currentClassData = {
                            fileName,
                            line: classData.line,
                            index: classData.index,
                            es: classData.es,
                            workspace: inWorkspace,
                            methods: {},
                            languageId: 'javascript',
                        };
                        this.iqgeoVSCode.addClassData(currentClass, currentClassData);
                        this.iqgeoVSCode.addParent(currentClass, classData.parent, 'javascript');
                        if (classData.es) {
                            this.iqgeoVSCode.esClasses.push(currentClass);
                        }
                        classFound = true; // debug flag
                    }
                }
            } else if (currentClass && indent === 1 && !inComment) {
                const functionName = this._findFunctionDef(str, line, fileLines);
                if (functionName) {
                    const name = `${functionName}()`;
                    currentClassData.methods[name] = {
                        name,
                        fileName,
                        line,
                        index: str.indexOf(functionName) + functionName.length,
                        kind: vscode.SymbolKind.Method,
                    };
                    symbolCount++; // debug counter
                } else {
                    const propName = this._findPropertyDef(str);
                    if (propName) {
                        currentClassData.methods[propName] = {
                            name: propName,
                            fileName,
                            line,
                            index: str.indexOf(propName) + propName.length,
                            kind: vscode.SymbolKind.Property,
                        };
                        symbolCount++; // debug counter
                    }
                }
            } else if (currentClass) {
                const mixinMatch = testStr.match(INCLUDE_MIXIN_REG);
                if (mixinMatch) {
                    const mixinName = mixinMatch[1];
                    this.iqgeoVSCode.addParent(currentClass, mixinName, 'javascript');
                }
            }

            const prevIndent = indent;
            bracketMatches = testStr.match(INC_BRACKETS);
            if (bracketMatches) {
                indent += bracketMatches.length;
            }
            bracketMatches = testStr.match(DEC_BRACKETS);
            if (bracketMatches) {
                indent -= bracketMatches.length;
            }
            if (indent !== prevIndent && indent === 0) {
                currentClass = undefined;
            }
        }

        if (this.iqgeoVSCode.DEBUG) {
            if (!classFound && symbolCount === 0) {
                console.log('No class or symbols found in', fileName);
            } else if (!classFound) {
                console.log('No class found in', fileName);
            } else if (symbolCount === 0) {
                console.log('No symbols found in', fileName);
            }
        }
    }

    getCurrentClass(doc, currentLine) {
        let fileLines = Utils.getDocLines(doc);

        let classData = this._findClassDefAssign(fileLines);
        if (classData) return classData.class;

        fileLines = fileLines.slice(0, currentLine + 1);

        for (let line = currentLine; line > -1; line--) {
            const str = fileLines[line];
            classData = this._findClassDef(str, line, fileLines);
            if (classData) {
                return classData.class;
            }
        }
    }

    _findClassDef(str, line, fileLines) {
        let match = str.match(EXTEND_NO_STRING_REG);
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            return {
                class: match[1],
                parent: match[2],
                line,
                index,
            };
        }

        match = str.match(EXTEND_REG);
        if (match) {
            const index = str.indexOf(match[2]) + match[2].length;
            return {
                class: match[2],
                parent: match[1],
                line,
                index,
            };
        }

        match = str.match(CLASS_REG);
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            const parent = match[2];
            return {
                class: match[1],
                parent,
                line,
                index,
                es: true,
            };
        }

        match = str.match(RENAME_CLASS_REG);
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            return {
                class: match[1],
                line,
                index,
                es: true,
            };
        }

        match = str.match(NAMESPACE_CLASS_REG);
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            const parent = match[2];
            return {
                class: match[1],
                parent,
                line,
                index,
                es: true,
            };
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            NAMESPACE_CLASS_MULTI_LINE_REG,
            NAMESPACE_CLASS_REG
        );
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            return {
                class: match[1],
                parent: match[2],
                line,
                index,
                es: true,
            };
        }

        match = str.match(EXPORT_MIXIN_REG);
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            return { class: match[1], line, index };
        }

        match = str.match(MIXIN_REG);
        if (match && this._exportExists(match[1], line, fileLines)) {
            const index = str.indexOf(match[1]) + match[1].length;
            return { class: match[1], line, index };
        }

        match = Utils.matchMultiLine(str, line, fileLines, EXTEND_MULTI_REG, EXTEND_REG);
        if (match) {
            const index = str.indexOf(match[2]) + match[2].length;
            return {
                class: match[2],
                parent: match[1],
                line,
                index,
            };
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            EXTEND_NO_STRING_MULTI_REG,
            EXTEND_NO_STRING_REG
        );
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            return {
                class: match[1],
                parent: match[2],
                line,
                index,
            };
        }
    }

    _findClassDefAssign(fileLines) {
        const len = fileLines.length;
        for (let line = len - 1; line > -1; line--) {
            const str = fileLines[line];
            const match = str.match(CLASS_ASSIGN_REG);
            if (match) {
                const className = match[2];
                const index = str.indexOf(className) + className.length + 1;
                return {
                    class: className,
                    parent: match[1],
                    line,
                    index,
                };
            }
            if (str.trim().length !== 0) {
                return;
            }
        }
    }

    _findFunctionDef(str, line, fileLines) {
        let match = str.match(FUNCTION_REG);
        if (match) {
            return match[1];
        }

        match = str.match(ARROW_FUNCTION_REG);
        if (match) {
            return match[1];
        }

        match = Utils.matchMultiLine(str, line, fileLines, FUNCTION_MULTI_LINE_REG, FUNCTION_REG);
        if (match) {
            return match[1];
        }
    }

    _findExportFunctionDef(str, line, fileLines) {
        let match = str.match(EXPORT_FUNCTION_REG);
        if (match) {
            return match[1];
        }
        match = str.match(EXPORT_ARROW_FUNCTION_REG);
        if (match) {
            return match[1];
        }
        match = str.match(CONST_FUNCTION_REG);
        if (match && this._exportExists(match[1], line, fileLines)) {
            return match[1];
        }
        match = str.match(CONST_ARROW_FUNCTION_REG);
        if (match && this._exportExists(match[1], line, fileLines)) {
            return match[1];
        }
        match = str.match(NO_CONST_FUNCTION_REG);
        if (match && this._exportExists(match[1], line, fileLines)) {
            return match[1];
        }
        match = str.match(EXPORT_FUNCTION_RESULT_REG);
        if (match) {
            return match[1];
        }
        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            EXPORT_ARROW_FUNCTION_MULTI_LINE_REG,
            EXPORT_ARROW_FUNCTION_REG
        );
        if (match) {
            return match[1];
        }
        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            CONST_FUNCTION_MULTI_LINE_REG,
            CONST_ARROW_FUNCTION_REG
        );
        if (match && this._exportExists(match[1], line, fileLines)) {
            return match[1];
        }
    }

    _findPropertyDef(str) {
        let match = str.match(PROPERTY_REG);
        if (match) {
            return match[1];
        }

        match = str.match(SETTER_OR_GETTER_REG);
        if (match) {
            return match[1];
        }
    }

    _exportExists(name, currentLine, fileLines) {
        const len = fileLines.length;
        const testName = name.replace(/\./g, '\\.');
        const exportReg = new RegExp(`^export\\s+(default\\s+)?${testName};`);
        const exportStartReg = /^export\s+.*?{/;
        const multiLineExportReg = new RegExp(`^export\\s+.*?{.*?\\s+${testName}.*?}`);
        const noIndent = /^[^\s]+/;
        let endLine = len;

        for (let line = len - 1; line > currentLine; line--) {
            const str = fileLines[line];
            if (exportReg.test(str)) {
                return true;
            }
            if (exportStartReg.test(str)) {
                const exportStr = fileLines.slice(line, endLine).join();
                if (multiLineExportReg.test(exportStr)) {
                    return true;
                }
                endLine = line - 1;
            } else if (noIndent.test(str)) {
                endLine = line;
            }
        }

        return false;
    }
}

module.exports = IQGeoJSSearch;
