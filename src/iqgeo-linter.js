import vscode from 'vscode'; // eslint-disable-line
import util from 'util';
import Utils from './utils';

const PROTECTED_CALL_REG = /(\w+)(?<!this)\.(_\w+)\(?/g;
const METHOD_CALL_REG = /(\w+(?:\(.*?\))?)\.(\w+)\(/;
const COMMENT_START_REG = /^\s*(\/\/|\/\*\*?|\*)/;
const JS_CLASSES = [String, Array, Object, Number, Date, Set, Map, Promise]; // basic built-in classes
const IGNORE_METHOD_NAMES = [
    'after',
    'animate',
    'append',
    'attachShadow',
    'before',
    'closest',
    'computedStyleMap',
    'getAttribute',
    'getAttributeNS',
    'getAttributeNames',
    'getAttributeNode',
    'getAttributeNodeNS',
    'getBoundingClientRect',
    'getClientRects',
    'getElementsByClassName',
    'getElementsByTagName',
    'getElementsByTagNameNS',
    'getInnerHTML',
    'hasAttribute',
    'hasAttributeNS',
    'hasAttributes',
    'hasPointerCapture',
    'insertAdjacentElement',
    'insertAdjacentHTML',
    'insertAdjacentText',
    'matches',
    'prepend',
    'querySelector',
    'querySelectorAll',
    'releasePointerCapture',
    'remove',
    'removeAttribute',
    'removeAttributeNS',
    'removeAttributeNode',
    'replaceChildren',
    'replaceWith',
    'requestFullscreen',
    'requestPointerLock',
    'scroll',
    'scrollBy',
    'scrollIntoView',
    'scrollIntoViewIfNeeded',
    'scrollTo',
    'setAttribute',
    'setAttributeNS',
    'setAttributeNode',
    'setAttributeNodeNS',
    'setPointerCapture',
    'toggleAttribute',
    'webkitMatchesSelector',
    'webkitRequestFullScreen',
    'webkitRequestFullscreen',
    'checkVisibility',
    'getAnimations',
    'attachInternals',
    'blur',
    'click',
    'focus',
    'hidePopover',
    'showPopover',
    'togglePopover',
    'checkValidity',
    'reportValidity',
    'setCustomValidity',
    'select',
    'setRangeText',
    'setSelectionRange',
    'showPicker',
    'stepDown',
    'stepUp',

    'parent',
    'children',
    'siblings',
    'is',
    'addClass',
    'toggleClass',
    'appendTo',
    'width',
    'outerWidth',
    'height',
    'outerHeight',
    'attr',
    'html',
    'stopPropagation',
    'bind',
    'setVisible',
    'trigger',
    'addListener',
    'removeListener',

    'hasOwn',
];

const GATHER_PARAMS = ['...', '*args', '**kwargs'];

/**
 * Linter for IQGeo JavaScript code.
 * Raises errors for:
 * - Use of protected methods outside of class
 * - Public methods without API documentation
 * - Classes without API documentation
 * - Subclassed protected methods without call to super
 * - Method calls that can't be resolved
 */
export class IQGeoLinter {
    constructor(iqgeoVSCode, context) {
        this.iqgeoVSCode = iqgeoVSCode;

        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('iqgeo-javascript');

        vscode.workspace.onDidOpenTextDocument((doc) => {
            if (['javascript', 'python'].includes(doc.languageId)) {
                this._checkFile(doc).catch((err) => {
                    this.iqgeoVSCode.outputChannel.error(util.format(err));
                });
            }
        });

        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (['javascript', 'python'].includes(doc.languageId)) {
                this._checkFile(doc).catch((err) => {
                    this.iqgeoVSCode.outputChannel.error(util.format(err));
                });
            }
        });

        vscode.workspace.onDidCloseTextDocument((doc) => {
            this.diagnosticCollection.delete(doc.uri);
        });

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.checkSubclassSignatures', () =>
                this.checkSubclassSignatures()
            )
        );
    }

    _checkClassComments(classes, fileLines, diagnostics, apiSeverity) {
        for (const className of classes) {
            const classData = this.iqgeoVSCode.getClassData(className, 'javascript');
            if (!classData) continue;
            const classLine = classData.line;

            for (let line = classLine - 1; line >= 0; line--) {
                const str = fileLines[line].trim();
                if (str.length === 0) continue;
                if (str.startsWith('//')) continue;
                if (!/^\/?\*/.test(str)) {
                    const index = fileLines[classLine].indexOf(className);
                    const range = new vscode.Range(
                        classLine,
                        index,
                        classLine,
                        index + className.length
                    );
                    const d = new vscode.Diagnostic(
                        range,
                        `Class '${className}' does not have API documentation.`,
                        apiSeverity
                    );
                    diagnostics.push(d);
                }
                break;
            }
        }
    }

    _checkProtectedCalls(row, str, diagnostics) {
        let startIndex = 0;
        let match;

        while ((match = PROTECTED_CALL_REG.exec(str))) {
            if (['super', 'self', 'prototype'].includes(match[1])) continue;

            const name = match[2];
            let displayName = name;
            let type = 'property';
            if (match[0].endsWith('(')) {
                displayName = `${name}()`;
                type = 'function';
            }
            const index = str.indexOf(name, startIndex);

            const range = new vscode.Range(row, index, row, index + name.length);
            const d = new vscode.Diagnostic(
                range,
                `Use of protected ${type} '${displayName}' outside of class.`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostics.push(d);

            startIndex = index + name.length;
        }
    }

    _hasParentFunction(className, methodName) {
        for (const parentClassName of this.iqgeoVSCode.getParents(className, 'javascript')) {
            const parentClassData = this.iqgeoVSCode.getClassData(parentClassName, 'javascript');
            if (parentClassData && parentClassData.methods[methodName]) {
                return true;
            }
            if (this._hasParentFunction(parentClassName, methodName)) {
                return true;
            }
        }
        return false;
    }

    _inheritsThirdParty(className) {
        for (const parentClassName of this.iqgeoVSCode.getParents(className, 'javascript')) {
            if (!this.iqgeoVSCode.getClassData(parentClassName, 'javascript')) {
                return true;
            }
            if (this._inheritsThirdParty(parentClassName)) {
                return true;
            }
        }
        return false;
    }

    _inheritsThirdPartyOnly(className) {
        let thirdParty = false;
        for (const parentClassName of this.iqgeoVSCode.getParents(className, 'javascript')) {
            if (this.iqgeoVSCode.getClassData(parentClassName, 'javascript')) {
                return false;
            } else {
                thirdParty = true;
            }
        }
        return thirdParty;
    }

    _checkMethodComments(classes, fileName, fileLines, diagnostics, apiSeverity) {
        const publicMethods = [];

        for (const className of classes) {
            const classData = this.iqgeoVSCode.getClassData(className, 'javascript');
            for (const [methodName, methodData] of Object.entries(classData.methods)) {
                if (
                    !['_', '#'].includes(methodName[0]) &&
                    !this._hasParentFunction(className, methodName)
                ) {
                    publicMethods.push(methodData);
                }
            }
        }

        for (const methodData of this.iqgeoVSCode.allFunctions()) {
            if (
                methodData.fileName === fileName &&
                methodData.exported &&
                !['_', '#'].includes(methodData.name[0])
            ) {
                publicMethods.push(methodData);
            }
        }

        for (const methodData of publicMethods) {
            // Check method is preceeded by a comment
            const methodLine = methodData.line;
            for (let line = methodLine - 1; line >= 0; line--) {
                const str = fileLines[line].trim();
                if (str.length === 0) continue;
                if (str.startsWith('//')) continue;
                if (!/^\/?\*/.test(str)) {
                    const name = methodData.name.split('()')[0];
                    const index = fileLines[methodLine].indexOf(name);
                    if (index === -1) break;

                    const range = new vscode.Range(
                        methodLine,
                        index,
                        methodLine,
                        index + name.length
                    );
                    const d = new vscode.Diagnostic(
                        range,
                        `Public method '${methodData.name}' does not have API documentation.`,
                        apiSeverity
                    );
                    diagnostics.push(d);
                }
                break;
            }
        }
    }

    _checkProtectedSuperCalls(classes, fileLines, diagnostics) {
        const subProtectedMethods = [];

        for (const className of classes) {
            const classData = this.iqgeoVSCode.getClassData(className, 'javascript');
            for (const [methodName, methodData] of Object.entries(classData.methods)) {
                if (methodName[0] === '_' && this._hasParentFunction(className, methodName)) {
                    subProtectedMethods.push(methodData);
                }
            }
        }

        subProtectedMethods.sort((a, b) => a.line - b.line);

        const last = subProtectedMethods.length - 1;
        for (const [index, methodData] of subProtectedMethods.entries()) {
            const methodLine = methodData.line;
            const endLine = index === last ? fileLines.length : subProtectedMethods[index + 1].line;
            const name = methodData.name.split('()')[0];
            const superReg = new RegExp(`\\bsuper\\.${name}`);
            let foundSuperCall = false;

            for (let line = methodLine; line < endLine; line++) {
                if (superReg.test(fileLines[line])) {
                    foundSuperCall = true;
                    break;
                }
            }

            if (!foundSuperCall) {
                const index = fileLines[methodLine].indexOf(name);
                if (index === -1) continue;

                const range = new vscode.Range(methodLine, index, methodLine, index + name.length);
                const d = new vscode.Diagnostic(
                    range,
                    `Subclassed protected method '${methodData.name}' does not have a super call.`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostics.push(d);
            }
        }
    }

    _isCommonJS(name) {
        return JS_CLASSES.some((obj) => Object.hasOwn(obj.prototype, name));
    }

    async _checkMethodCalls(uri, fileLines, diagnostics) {
        const len = fileLines.length;
        const testedNames = new Set();

        for (let line = 0; line < len; line++) {
            const lineStr = fileLines[line];
            if (COMMENT_START_REG.test(lineStr)) continue;

            let str = lineStr;
            let startIndex = 0;
            let match;

            while ((match = str.match(METHOD_CALL_REG))) {
                const methodName = match[2];
                const index = lineStr.indexOf(`.${methodName}`, startIndex) + 1;

                if (
                    !['this', 'super', 'document'].includes(match[1]) &&
                    !testedNames.has(methodName) &&
                    !this._isCommonJS(methodName) &&
                    !IGNORE_METHOD_NAMES.includes(methodName)
                ) {
                    let found = false;

                    for (const [, classData] of this.iqgeoVSCode.allClasses()) {
                        const methods = classData.methods;
                        if (methods[`${methodName}()`]) {
                            found = true;
                            break;
                        }
                    }

                    if (found) {
                        testedNames.add(methodName);
                    } else {
                        // Double check the method call can't be resolved
                        const pos = new vscode.Position(line, index);
                        const locs = await vscode.commands.executeCommand(
                            'vscode.executeDefinitionProvider',
                            uri,
                            pos
                        );

                        if (locs.length === 0) {
                            const range = new vscode.Range(
                                line,
                                index,
                                line,
                                index + methodName.length
                            );
                            const d = new vscode.Diagnostic(
                                range,
                                `Method '${methodName}()' not found.`,
                                vscode.DiagnosticSeverity.Error
                            );
                            diagnostics.push(d);
                        }
                    }
                }

                str = lineStr.slice(index);
                startIndex = index;
            }
        }
    }

    checkSubclassSignatures() {
        let classCount = 0;
        let warningCount = 0;

        for (let languageId of ['javascript', 'python']) {
            this.iqgeoVSCode.outputChannel.info(
                `Checking subclass signatures for ${languageId}...`
            );

            for (const key of this.iqgeoVSCode.classes.keys()) {
                const [className, id] = key.split(':');
                if (id !== languageId) continue;

                classCount++;

                const classData = this.iqgeoVSCode.getClassData(className, languageId);
                for (const methodData of Object.values(classData.methods)) {
                    const parentMethod = this._checkSignature(className, methodData, languageId);
                    if (parentMethod) {
                        this.iqgeoVSCode.outputChannel.info(
                            `${className}.${
                                methodData.name
                            } does not match signature of base method in parent ${
                                parentMethod.className
                            }.\n (${methodData.paramString
                                .trim()
                                .replace(/\s\s+/g, ' ')}) vs (${parentMethod.paramString
                                .trim()
                                .replace(/\s\s+/g, ' ')})`
                        );
                        warningCount++;
                    }
                }
            }
        }

        this.iqgeoVSCode.outputChannel.info(`${classCount} classes checked.`);

        if (warningCount > 0) {
            this.iqgeoVSCode.outputChannel.info(
                `Found ${warningCount} subclass signature warnings.`
            );
        }
    }

    _checkSignaturesForClasses(classes, fileLines, diagnostics, languageId) {
        for (const className of classes) {
            const classData = this.iqgeoVSCode.getClassData(className, languageId);
            if (!classData) continue;

            for (const methodData of Object.values(classData.methods)) {
                const parentMethod = this._checkSignature(className, methodData, languageId);
                if (parentMethod) {
                    const methodLine = methodData.line;
                    const name = methodData.name.split('()')[0];
                    const index = fileLines[methodLine].indexOf(name);
                    if (index === -1) continue;

                    const range = new vscode.Range(
                        methodLine,
                        index,
                        methodLine,
                        index + name.length
                    );
                    const d = new vscode.Diagnostic(
                        range,
                        `'${methodData.name}' does not match signature of base method in parent '${parentMethod.className}'`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostics.push(d);
                }
            }
        }
    }

    _checkSignature(className, methodData, languageId) {
        if (!methodData.paramString) return;
        if (languageId === 'python' && methodData.name === '__init__()') return;
        if (languageId === 'javascript' && methodData.name === 'constructor()') return;

        const methParamTypes = this._getParamTypes(methodData.paramString);
        const nPosParams = this._numPositionalParams(methParamTypes);

        for (const parentMethod of this._getSuperMethodData(
            className,
            languageId,
            methodData.name
        )) {
            const parentParamTypes = this._getParamTypes(parentMethod.paramString);
            const nParentPosParams = this._numPositionalParams(parentParamTypes);

            if (
                (nPosParams > nParentPosParams &&
                    !methParamTypes.every(
                        (p, index) =>
                            index < nParentPosParams || index >= nPosParams || p === 'param_default'
                    )) ||
                (nPosParams < nParentPosParams &&
                    !GATHER_PARAMS.some((p) => methParamTypes.includes(p)))
            ) {
                return parentMethod;
            }
        }
    }

    _getSuperMethodData(className, languageId, methodName, result = []) {
        const parents = this.iqgeoVSCode.getParents(className, languageId);

        for (const parentName of parents) {
            const parentData = this.iqgeoVSCode.getClassData(parentName, languageId);
            if (parentData) {
                const parentMethodData = parentData.methods[methodName];
                if (parentMethodData && parentMethodData.kind === vscode.SymbolKind.Method) {
                    result.push(parentMethodData);
                } else {
                    this._getSuperMethodData(parentName, languageId, methodName, result);
                }
            }
        }

        return result;
    }

    _getParamTypes(str) {
        const types = [];
        if (!str || str.trim().length === 0) {
            return types;
        }

        const reg = /(?:\w+\s*:\s*"?([\w|.\s\[\],]+)|(\w+))/;
        const parts = str.split(',');
        const paramStrings = [];
        let testStr = '';

        for (let i = 0; i < parts.length; i++) {
            testStr += parts[i];
            const count =
                (testStr.match(/[\[{]/g) || []).length - (testStr.match(/[\]}]/g) || []).length;
            if (count === 0) {
                testStr = testStr.trim();
                if (testStr.length > 0) {
                    paramStrings.push(testStr);
                    testStr = '';
                }
            } else {
                testStr += ',';
            }
        }

        for (const paramStr of paramStrings) {
            if (paramStr.startsWith('...')) {
                types.push('...');
            } else if (paramStr.startsWith('{')) {
                types.push('{}');
            } else if (paramStr.startsWith('[')) {
                types.push('[]');
            } else if (paramStr.startsWith('**')) {
                types.push('**kwargs');
            } else if (paramStr === '*') {
                types.push('*');
            } else if (paramStr.startsWith('*')) {
                types.push('*args');
            } else if (paramStr === '/') {
                types.push('/');
            } else if (paramStr.includes('=')) {
                types.push('param_default');
            } else {
                const match = paramStr.match(reg);
                if (match && match[1]) {
                    types.push(match[1].trim());
                } else {
                    types.push('param');
                }
            }
        }

        // Debug
        // console.log(str, ' >> ', types.join(', '));

        return types;
    }

    _numPositionalParams(types) {
        let count = 0;
        for (const type of types) {
            if (type === '...' || type === '*' || type === '*args' || type === '*kwargs') {
                break;
            }
            if (type !== '/') {
                count++;
            }
        }
        return count;
    }

    async _checkFile(doc) {
        const config = vscode.workspace.getConfiguration('iqgeo-utils-vscode');
        if (!config.enableLinting) return;

        if (
            doc.fileName.includes('/node_modules/') ||
            !this.iqgeoVSCode.rootFolders.some((folder) => doc.fileName.startsWith(folder))
        ) {
            return;
        }

        const apiSeverity =
            vscode.DiagnosticSeverity[config.apiLintingSeverity] ?? vscode.DiagnosticSeverity.Error;

        const fileName = doc.fileName;
        const diagnostics = [];
        const classes = [];

        for (const [className, classData] of this.iqgeoVSCode.allClasses()) {
            if (classData.fileName === fileName) {
                classes.push(className);
            }
        }

        const uri = doc.uri;
        const fileLines = Utils.getFileLines(doc.fileName);
        const languageId = doc.languageId;

        if (languageId === 'javascript') {
            const len = fileLines.length;

            for (let line = 0; line < len; line++) {
                const str = fileLines[line];
                this._checkProtectedCalls(line, str, diagnostics);
            }

            if (config.enableMethodCheck) {
                await this._checkMethodCalls(uri, fileLines, diagnostics);
            }

            this._checkProtectedSuperCalls(classes, fileLines, diagnostics);

            this._checkClassComments(classes, fileLines, diagnostics, apiSeverity);

            this._checkMethodComments(classes, fileName, fileLines, diagnostics, apiSeverity);
        }

        this._checkSignaturesForClasses(classes, fileLines, diagnostics, languageId);

        this.diagnosticCollection.set(uri, diagnostics);
    }

    /**
     * Check all open JavaScript files for linting errors.
     * Called on extension activation.
     */
    checkOpenFiles() {
        for (const doc of vscode.workspace.textDocuments) {
            if (['javascript', 'python'].includes(doc.languageId)) {
                this._checkFile(doc).catch((err) => {
                    this.iqgeoVSCode.outputChannel.error(util.format(err));
                });
            }
        }
    }
}
