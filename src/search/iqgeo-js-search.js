import vscode from 'vscode'; // eslint-disable-line
import Utils from '../utils';

export class IQGeoJSSearch {
    extendReg = /(\w+)\.extend\s*\(\s*['"](\w+)['"]/;
    extendMultiLineReg = /(\w+)\.extend\s*\(\s*$/;
    extendNoStringReg = /(\w+)\s*=.*?(\w+)\.extend\s*\((\s*['"]([\w\s]+)['"]\s*,)?\s*{/;
    extendNoStringMultiLineReg = /(\w+)\s*=.*?(\w+)\.extend\s*\(\s*$/;
    classReg = /^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)\s+(?:extends)?.*?(\w+)?\s*{/;
    namespaceClassReg = /(?:\w+)\s*=\s*class\s+(\w+)\s+(?:extends)?.*?(\w+)?\s*\)?\s*{/;
    namespaceClassMultiLineReg = /(?:\w+)\s*=\s*class\s+(\w+)\s+(?:extends)\s*\(?/;
    renameClassReg = /^\s*export\s+const\s+(\w+)\s+=\s+\w+;/;
    mixinReg = /(\w+(Mixin)?)\s*=\s*{/;
    exportMixinReg = /^export\s+(?:(?:default|const)\s+)*(\w+(Mixin)?)\s*=\s*{/;
    classAssignReg = /(?:^|\s+)Object\.assign\(.*?(\w+)\.prototype,\s*(\w+)\)/;
    propertyReg = /^\s*(?:static\s+|readonly\s+|#)*(\w+)\??(:|\s*=)/;
    setterOrGetterReg = /^\s*(?:readonly\s+|#)*(?:(?:set|get)\s+)(\w+)\s*\(/;
    functionReg = /^\s*(?:async\s+|static\s+|#)*\*?(\w+)\s*\((.*?)\)\s*{/;
    functionMultiLineReg = /^\s*(async\s*|static\s*|#)*\*?\w+\s*\(\s*$/;
    constFunctionReg = /^\s*const\s+(\w+)\s*=\s*(?:async\s+)?function\*?\s*\(/;
    constArrowFunctionReg = /^\s*const\s+(\w+)\s*=\s*(\(.*?\)|[^\s[{][^;.]*?)\s+=>\s+/;
    constFunctionMultiLineReg = /^\s*const\s+(\w+)\s*=\s*/;
    constArrowFunctionMultiLineReg = /^\s*const\s+(\w+)\s*=\s*(\(.*?|[^\s[{][^;.]*?$|$)/;
    noConstFunctionReg = /^\s*(?:async\s+)?function\*?\s+(\w+)\s*\(/;
    arrowFunctionReg = /^\s*(?:async\s+)?(\w+)\s*=\s*(\(.*?\)|[^;.]*?)\s+=>\s+/;
    exportFunctionReg = /^export\s+(?:(?:default|async)\s+)*function\*?\s+(\w+)\s*\(/;
    exportArrowFunctionReg =
        /^export\s+(?:(?:default|async|const)\s+)*(\w+)\s*=\s*(\(.*?\)|[^;.]*?)\s+=>\s/;
    exportArrowFunctionMultiLineReg = /^export\s+((default|async|const)\s+)*(\w+)\s*=/;
    exportFunctionResultReg = /^export\s+(?:(?:default|const)\s+)*(\w+)\s*=\s*.*?(\w+)\s*\(/;
    includeMixinReg = /^\s*this.include\(\s*(\w+)\s*\)/;
    literalBeforeQuoteReg = /^[^'"]*`/;
    regAssign =
        /^\s*(?:(?:static\s+|public\s+|private\s+|protected\s+|readonly\s+|const\s+|let\s+|#)*\w+\s*=\s*)?\/(.*?)\/\w*;\s*$/;
    incBracketsReg = /(?<!%)[{]/g;
    decBracketsReg = /(?<!%)[}]/g;

    constructor(iqgeoVSCode) {
        this.iqgeoVSCode = iqgeoVSCode;
        this.languageId = 'javascript';
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
        let classData;
        let currentClass;
        let currentClassData;
        let indent = 0;
        let funcIndentStr;
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
                languageId: this.languageId,
            };
            this.iqgeoVSCode.addClassData(currentClass, currentClassData);
            this.iqgeoVSCode.addParent(currentClass, classData.parent, this.languageId);
            classFound = true; // debug flag
        }

        for (let line = 0; line < len; line++) {
            const str = fileLines[line];
            let testStr = Utils.removeLineComment(str);

            const prevIndent = indent;

            [testStr, inComment] = Utils.removeComments(testStr, inComment);

            if (inLiteral || this.literalBeforeQuoteReg.test(testStr)) {
                [testStr, inLiteral] = Utils.removeLiterals(testStr, inLiteral);
                testStr = Utils.removeStrings(testStr);
            } else {
                testStr = Utils.removeStrings(testStr);
                [testStr, inLiteral] = Utils.removeLiterals(testStr, inLiteral);
            }

            if (indent === 0) {
                let functionName = this._findExportFunctionDef(str, line, fileLines);
                let exported = true;
                if (!functionName) {
                    exported = false;
                    functionName = this._findPrivateFunctionDef(str, line, fileLines);
                }
                if (functionName) {
                    this.iqgeoVSCode.addFunction(functionName, {
                        fileName,
                        line,
                        index: str.indexOf(functionName) + functionName.length,
                        workspace: inWorkspace,
                        languageId: this.languageId,
                        exported,
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
                            languageId: this.languageId,
                        };
                        this.iqgeoVSCode.addClassData(currentClass, currentClassData);
                        this.iqgeoVSCode.addParent(currentClass, classData.parent, this.languageId);
                        if (classData.es) {
                            this.iqgeoVSCode.esClasses.push(currentClass);
                        }
                        funcIndentStr = undefined;
                        classFound = true; // debug flag
                    }
                }
            } else if (currentClass && indent === 1 && !inComment) {
                const [functionName, paramString] = this._findFunctionDef(str, line, fileLines);
                if (functionName) {
                    const name = `${functionName}()`;
                    currentClassData.methods[name] = {
                        name,
                        className: currentClass,
                        fileName,
                        line,
                        index: str.indexOf(functionName) + functionName.length,
                        kind: vscode.SymbolKind.Method,
                        paramString,
                    };
                    funcIndentStr = fileLines[line].match(/^\s*/)[0];
                    symbolCount++; // debug counter
                } else {
                    const propName = this._findPropertyDef(str);
                    if (
                        propName &&
                        (!funcIndentStr || funcIndentStr === fileLines[line].match(/^\s*/)[0])
                    ) {
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
                const mixinMatch = testStr.match(this.includeMixinReg);
                if (mixinMatch) {
                    const mixinName = mixinMatch[1];
                    this.iqgeoVSCode.addParent(currentClass, mixinName, this.languageId);
                }
            } else if (indent < 2 && !inComment) {
                const functionName = this._findPrivateFunctionDef(str, line, fileLines);
                if (functionName) {
                    this.iqgeoVSCode.addFunction(functionName, {
                        fileName,
                        line,
                        index: str.indexOf(functionName) + functionName.length,
                        workspace: inWorkspace,
                        languageId: this.languageId,
                        exported: false,
                    });
                    symbolCount++; // debug counter
                }
            }

            indent = this._getCurrentIndent(testStr, prevIndent);

            if (indent !== prevIndent && indent === 0) {
                currentClass = undefined;
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

    _getCurrentIndent(testStr, prevIndent) {
        let indent = prevIndent;
        const regMatch = testStr.match(this.regAssign);

        if (regMatch) {
            const regMin = testStr.indexOf(regMatch[1]);
            const regMax = regMin + regMatch[1].length;

            let bracketMatch;
            while ((bracketMatch = this.incBracketsReg.exec(testStr))) {
                const i = bracketMatch.index;
                if (i < regMin && i >= regMax) {
                    indent++;
                }
            }
            while ((bracketMatch = this.decBracketsReg.exec(testStr))) {
                const i = bracketMatch.index;
                if (i < regMin && i >= regMax) {
                    indent--;
                }
            }
        } else {
            let bracketMatches = testStr.match(this.incBracketsReg);
            if (bracketMatches) {
                indent += bracketMatches.length;
            }
            bracketMatches = testStr.match(this.decBracketsReg);
            if (bracketMatches) {
                indent -= bracketMatches.length;
            }
        }

        return indent;
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
        let match = str.match(this.extendNoStringReg);
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            return {
                class: match[1],
                parent: match[2],
                line,
                index,
            };
        }

        match = str.match(this.extendReg);
        if (match) {
            const index = str.indexOf(match[2]) + match[2].length;
            return {
                class: match[2],
                parent: match[1],
                line,
                index,
            };
        }

        match = str.match(this.classReg);
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

        match = str.match(this.renameClassReg);
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            return {
                class: match[1],
                line,
                index,
                es: true,
            };
        }

        match = str.match(this.namespaceClassReg);
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
            this.namespaceClassMultiLineReg,
            this.namespaceClassReg
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

        match = str.match(this.exportMixinReg);
        if (match) {
            const index = str.indexOf(match[1]) + match[1].length;
            return { class: match[1], line, index };
        }

        match = str.match(this.mixinReg);
        if (match && this._exportExists(match[1], line, fileLines)) {
            const index = str.indexOf(match[1]) + match[1].length;
            return { class: match[1], line, index };
        }

        match = Utils.matchMultiLine(str, line, fileLines, this.extendMultiLineReg, this.extendReg);
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
            this.extendNoStringMultiLineReg,
            this.extendNoStringReg
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
            const match = str.match(this.classAssignReg);
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
        let match = str.match(this.functionReg);
        if (match) {
            return [match[1], match[2]];
        }

        match = str.match(this.arrowFunctionReg);
        if (match) {
            return [match[1], match[2]];
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            this.functionMultiLineReg,
            this.functionReg
        );
        if (match) {
            return [match[1], match[2]];
        }

        return [];
    }

    _findExportFunctionDef(str, line, fileLines) {
        let match = str.match(this.exportFunctionReg);
        if (match) {
            return match[1];
        }
        match = str.match(this.exportArrowFunctionReg);
        if (match) {
            return match[1];
        }
        match = str.match(this.constFunctionReg);
        if (match && this._exportExists(match[1], line, fileLines)) {
            return match[1];
        }
        match = str.match(this.constArrowFunctionReg);
        if (match && this._exportExists(match[1], line, fileLines)) {
            return match[1];
        }
        match = str.match(this.noConstFunctionReg);
        if (match && this._exportExists(match[1], line, fileLines)) {
            return match[1];
        }
        match = str.match(this.exportFunctionResultReg);
        if (match) {
            return match[1];
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            this.exportArrowFunctionMultiLineReg,
            this.exportArrowFunctionReg
        );
        if (match) {
            return match[1];
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            this.constFunctionMultiLineReg,
            this.constFunctionReg
        );
        if (match && this._exportExists(match[1], line, fileLines)) {
            return match[1];
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            this.constArrowFunctionMultiLineReg,
            this.constArrowFunctionReg
        );
        if (match && this._exportExists(match[1], line, fileLines)) {
            return match[1];
        }
    }

    _findPrivateFunctionDef(str, line, fileLines) {
        let match = str.match(this.constFunctionReg);
        if (match) {
            return match[1];
        }
        match = str.match(this.constArrowFunctionReg);
        if (match) {
            return match[1];
        }
        match = str.match(this.noConstFunctionReg);
        if (match) {
            return match[1];
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            this.constFunctionMultiLineReg,
            this.constFunctionReg
        );
        if (match) {
            return match[1];
        }

        match = Utils.matchMultiLine(
            str,
            line,
            fileLines,
            this.constArrowFunctionMultiLineReg,
            this.constArrowFunctionReg
        );
        if (match) {
            return match[1];
        }
    }

    _findPropertyDef(str) {
        let match = str.match(this.propertyReg);
        if (match) {
            return match[1];
        }

        match = str.match(this.setterOrGetterReg);
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
