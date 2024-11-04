import vscode from 'vscode'; // eslint-disable-line
import fs from 'fs';
import path from 'path';
import util from 'util';
import find from 'findit';
import { IQGeoSearch } from './search/iqgeo-search';
import { IQGeoJSSearch } from './search/iqgeo-js-search';
import { IQGeoPythonSearch } from './search/iqgeo-python-search';
import { IQGeoLinter } from './iqgeo-linter';
import { IQGeoJSDoc } from './iqgeo-jsdoc';
import { IQGeoWatch } from './iqgeo-watch';
import { IQGeoHistoryManager } from './iqgeo-history';
import Utils from './utils';

const PROTOTYPE_CALL_REG = /(\w+)\.prototype\.(\w+)\.(call|apply)\s*\(/;
const IMPORT_REG = /^\s*import\s+(\w*),?\s*{?([\w\s,]*)}?\s*from\s+['"](.*?)['"];?/;
const IMPORT_MULTI_LINE_REG = /^\s*import\s+/;

const IGNORE_DIRS = ['.git', 'node_modules', 'doc', 'coverage', 'bundles', 'Doc', 'Externals'];
const IGNORE_FILES = ['__init__.py', /\.bundle\.js$/, /\.min\.js$/, /\.Compiled\.js(\.map)?$/];

const DEBUG = false;

/**
 * Main class for IQGeo VSCode extension.
 * Provides:
 * - Workspace symbol search
 * - Definitions for JavaScript and Python
 * - Linting for JavaScript APIs
 */
export class IQGeoVSCode {
    /**
     * @param {vscode.ExtensionContext} context
     * @param {vscode.LogOutputChannel} outputChannel
     */
    constructor(context, outputChannel) {
        this.iqgeoSearch = new IQGeoSearch(this, context);
        this.linter = new IQGeoLinter(this);
        this.iqgeoJSDoc = new IQGeoJSDoc(this, context);
        this.watchManager = new IQGeoWatch(this, context);
        this.historyManager = new IQGeoHistoryManager(this, context);
        this.outputChannel = outputChannel;

        this.symbols = {};
        this.classes = new Map();
        this.parents = new Map();
        this.exportedFunctions = new Map();
        this.esClasses = [];
        this.rootFolders = [];
        this.allFiles = new Set();

        this.debug = DEBUG;

        const jsFile = {
            scheme: 'file',
            language: 'javascript',
        };

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.refreshSymbols', () => this.updateClasses())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.goToDefinition', () => this.goToDefinition())
        );

        context.subscriptions.push(vscode.languages.registerDefinitionProvider(jsFile, this));

        context.subscriptions.push(vscode.languages.registerTypeHierarchyProvider(jsFile, this));

        context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(this));

        this.iqgeoJSSearch = new IQGeoJSSearch(this);
        this.iqgeoPythonSearch = new IQGeoPythonSearch(this);

        this._languageConfig = [
            {
                languageId: 'javascript',
                extension: 'js',
                searchEngine: this.iqgeoJSSearch,
            },
            {
                languageId: 'python',
                extension: 'py',
                searchEngine: this.iqgeoPythonSearch,
            },
        ];

        vscode.workspace.onDidSaveTextDocument((doc) => {
            this.updateClassesForDoc(doc);
        });

        this._initSymbolsConfig();
    }

    onActivation() {
        this.updateClasses();
        this.historyManager.activate();
    }

    onDeactivation() {
        this.watchManager.stop();
        this.historyManager.deactivate();
    }

    _initSymbolsConfig() {
        this.symbolOrder = [
            vscode.SymbolKind.Class,
            vscode.SymbolKind.Constant,
            vscode.SymbolKind.Property,
            vscode.SymbolKind.Variable,
            vscode.SymbolKind.Method,
            vscode.SymbolKind.Function,
            vscode.SymbolKind.File,
        ];
        this.symbolIcons = {};
        this.symbolIcons[vscode.SymbolKind.Class] = 'symbol-class';
        this.symbolIcons[vscode.SymbolKind.Constant] = 'symbol-constant';
        this.symbolIcons[vscode.SymbolKind.Property] = 'symbol-property';
        this.symbolIcons[vscode.SymbolKind.Variable] = 'symbol-variable';
        this.symbolIcons[vscode.SymbolKind.Method] = 'symbol-method';
        this.symbolIcons[vscode.SymbolKind.Function] = 'symbol-method';
        this.symbolIcons[vscode.SymbolKind.File] = 'symbol-file';
    }

    // Find JS location only
    _findLocations(name, doc, searchAll = false) {
        const locations = [];

        const productCode = !this._isTestFile(doc.fileName);
        const inlcudeESOutside = this._includeESOutsideWorkspace();

        for (const [className, classData] of this.allClasses()) {
            // JS only
            if (classData.languageId !== 'javascript') continue;

            // Ignore test code when searching from product code.
            if (productCode && this._inTestFolder(classData)) continue;

            if (className === name) {
                if (searchAll || !classData.es || (inlcudeESOutside && !classData.workspace)) {
                    if (classData.location) {
                        locations.push(classData.location);
                    } else {
                        const loc = new vscode.Location(
                            vscode.Uri.file(classData.fileName),
                            new vscode.Position(classData.line, classData.index)
                        );
                        classData.location = loc;
                        locations.push(loc);
                    }
                }
            } else {
                const result = classData.methods[`${name}()`] || classData.methods[name];
                if (result) {
                    if (result.location) {
                        locations.push(result.location);
                    } else {
                        const loc = new vscode.Location(
                            vscode.Uri.file(result.fileName),
                            new vscode.Position(result.line, result.index)
                        );
                        result.location = loc;
                        locations.push(loc);
                    }
                }
            }
        }

        const imports = this._getNamedImports(doc);
        if (!imports.includes(name)) {
            for (const result of this.getExportedFunctions(name, 'javascript')) {
                if (result && (!productCode || !this._inTestFolder(result))) {
                    if (result.location) {
                        locations.push(result.location);
                    } else {
                        const loc = new vscode.Location(
                            vscode.Uri.file(result.fileName),
                            new vscode.Position(result.line, result.index)
                        );
                        result.location = loc;
                        locations.push(loc);
                    }
                }
            }
        }

        return locations;
    }

    _findMemberLocation(name, className, searchAll = false) {
        const classData = this.getClassData(className);
        if (!classData) return;

        const result = classData.methods[`${name}()`] || classData.methods[name];
        if (result) {
            // Ignore es classes
            if (
                !searchAll &&
                classData.es &&
                (classData.workspace || !this._includeESOutsideWorkspace())
            )
                return {};

            if (result.location) return result.location;
            const loc = new vscode.Location(
                vscode.Uri.file(result.fileName),
                new vscode.Position(result.line, result.index)
            );
            result.location = loc;
            return loc;
        }

        for (const parentClass of this.getParents(className)) {
            const loc = this._findMemberLocation(name, parentClass, searchAll);
            if (loc) return loc;
        }
    }

    async _findDefinition(doc, pos, searchAll = false) {
        // Note: used for JS only
        const currentWord = Utils.currentWord(doc, pos);
        if (!currentWord) return;

        let currentClass;
        let res;

        if (currentWord === 'super') {
            currentClass = this.iqgeoJSSearch.getCurrentClass(doc, pos.line);
            if (currentClass) {
                const functionData = this._getCurrentFunctionData(currentClass, doc, pos.line);
                if (functionData && functionData.name === 'constructor()') {
                    for (const parentClass of this.getParents(currentClass)) {
                        res = this._findMemberLocation('constructor()', parentClass, searchAll);
                        if (res) return res;
                    }
                }
            }
        }

        const previousWord = Utils.previousWord(doc, pos);
        if (!previousWord) return;

        if (previousWord === 'this') {
            if (!currentClass) {
                currentClass = this.iqgeoJSSearch.getCurrentClass(doc, pos.line);
            }
            if (currentClass) {
                res = this._findMemberLocation(currentWord, currentClass, searchAll);
                if (res) return res;
            }
        } else if (previousWord === 'super') {
            if (!currentClass) {
                currentClass = this.iqgeoJSSearch.getCurrentClass(doc, pos.line);
            }
            if (currentClass) {
                for (const parentClass of this.getParents(currentClass)) {
                    res = this._findMemberLocation(currentWord, parentClass, searchAll);
                    if (res) return res;
                }
            }
        }

        const currentLine = doc.lineAt(pos.line).text;
        const match = currentLine.match(PROTOTYPE_CALL_REG);
        if (match) {
            const index = currentLine.indexOf(match[0]);
            if (pos.character >= index && pos.character <= index + match[0].length) {
                res = this._findMemberLocation(match[2], match[1], searchAll);
                if (res) return res;
            }
        }

        return this._findLocations(currentWord, doc, searchAll);
    }

    _getTypeHierarchyItem(className) {
        const classData = this.getClassData(className);
        if (!classData) return;

        const detail = '';
        const uri = vscode.Uri.file(classData.fileName);
        const range = new vscode.Range(
            classData.line,
            classData.index - className.length,
            classData.line,
            classData.index
        );

        return new vscode.TypeHierarchyItem(
            vscode.SymbolKind.Class,
            className,
            detail,
            uri,
            range,
            range
        );
    }

    prepareTypeHierarchy(doc, pos) {
        const currentWord = Utils.currentWord(doc, pos);
        if (!currentWord) return;

        return this._getTypeHierarchyItem(currentWord);
    }

    provideTypeHierarchySubtypes(item) {
        const subTypes = [];
        for (const subClassName of this.getSubTypes(item.name)) {
            const item = this._getTypeHierarchyItem(subClassName);
            if (item) {
                subTypes.push(item);
            }
        }
        if (subTypes.length) return subTypes;
    }

    provideTypeHierarchySupertypes(item) {
        const superTypes = [];
        for (const parentClassName of this.getParents(item.name)) {
            const item = this._getTypeHierarchyItem(parentClassName);
            if (item) {
                superTypes.push(item);
            }
        }
        if (superTypes.length) return superTypes;
    }

    async provideDefinition(doc, pos) {
        const res = await this._findDefinition(doc, pos);
        if (res) {
            if (Array.isArray(res)) {
                return res;
            }
            if (res.uri) {
                return res;
            }
        }
    }

    async goToDefinition() {
        // Note: used for JS only
        const editor = vscode.window.activeTextEditor;
        let loc;

        if (editor) {
            const doc = editor.document;
            if (doc.languageId === 'javascript') {
                const pos = editor.selection.active;
                const res = await this._findDefinition(doc, pos, true);

                if (res) {
                    if (Array.isArray(res)) {
                        if (res.length === 1) {
                            loc = res[0];
                        }
                    } else if (res.uri) {
                        loc = res;
                    }
                }
            }
        }

        if (loc) {
            vscode.window.showTextDocument(loc.uri, {
                selection: loc.range,
            });
        } else {
            vscode.commands.executeCommand('editor.action.revealDefinition');
        }
    }

    _getIcon(kind) {
        return this.symbolIcons[kind] || 'symbol-misc';
    }

    getMethodSymbol(name, methodData) {
        let sym = methodData.symbol;
        if (!sym) {
            const { kind } = methodData;
            let loc = methodData.location;
            if (!loc) {
                loc = new vscode.Location(
                    vscode.Uri.file(methodData.fileName),
                    new vscode.Position(methodData.line, methodData.index)
                );
                methodData.location = loc;
            }

            sym = new vscode.SymbolInformation(name, kind, undefined, loc);
            sym._methodName = methodData.name;
            sym._fileName = methodData.fileName;
            sym._icon = this._getIcon(kind);
            sym._order = this.symbolOrder.indexOf(kind);

            methodData.symbol = sym;
        }
        return sym;
    }

    getClassSymbol(name, classData) {
        let sym = classData.symbol;
        if (!sym) {
            const kind = vscode.SymbolKind.Class;
            let loc = classData.location;
            if (!loc) {
                loc = new vscode.Location(
                    vscode.Uri.file(classData.fileName),
                    new vscode.Position(classData.line, classData.index)
                );
                classData.location = loc;
            }

            sym = new vscode.SymbolInformation(name, kind, undefined, loc);
            sym._fileName = classData.fileName;
            sym._className = name;
            sym._icon = this._getIcon(kind);
            sym._order = this.symbolOrder.indexOf(kind);

            classData.symbol = sym;
        }
        return sym;
    }

    getFileSymbol(fileName) {
        const name = path.basename(fileName);
        const kind = vscode.SymbolKind.File;
        const loc = new vscode.Location(vscode.Uri.file(fileName), new vscode.Position(0, 0));
        const sym = new vscode.SymbolInformation(name, kind, undefined, loc);

        sym._fileName = fileName;
        sym._icon = this._getIcon(kind);
        sym._order = this.symbolOrder.indexOf(kind);

        return sym;
    }

    _isLazyMatch(string, query, groupReg, reg = undefined) {
        const { length } = query;
        if (length === 0) return true; // special case to match all
        if (length > string.length) return false;

        if (reg) {
            // Check all characters are consecutive (with at least 1 other) in the shortest match of the query.
            const allMatches = string.match(reg) || [];
            if (allMatches.length === 0) return false;

            allMatches.sort((a, b) => a.length - b.length);

            const gaps = [];
            for (const match of allMatches[0].matchAll(groupReg)) {
                for (const str of match) {
                    if (str === '.') {
                        gaps.push(0);
                    } else {
                        gaps.push(str.length);
                    }
                }
            }
            gaps.shift();

            if (gaps[0] > 0 || gaps[gaps.length - 1] > 0) return false;
            for (let i = 1; i < gaps.length - 1; i++) {
                if (gaps[i] > 0 && gaps[i + 1] > 0) return false;
            }
            return true;
        }

        // Matches all characters of query in order and at least 2 characters are consecutive.
        for (const match of string.matchAll(groupReg)) {
            for (const str of match) {
                if (str.length === 0) return true;
            }
        }

        return false;
    }

    _lazyMatchGroupReg(query) {
        const chars = query.split('');
        let last = chars.pop();
        if (last === '.') last = '\\.';

        const groupsStr =
            chars
                .map((c) => {
                    let c1 = c;
                    if (c === '.') {
                        c1 = '\\.';
                    } else if (c === '\\') {
                        c1 = '\\\\';
                    }
                    return `${c1}([^${c}]*?)`;
                })
                .join('') + last;
        return new RegExp(groupsStr, 'g');
    }

    _lazyMatchReg(query) {
        const chars = query.split('');
        let last = chars.pop();
        if (last === '.') last = '\\.';

        const str =
            chars
                .map((c) => {
                    let c1 = c;
                    if (c === '.') {
                        c1 = '\\.';
                    } else if (c === '\\') {
                        c1 = '\\\\';
                    }
                    return `${c1}[^${c}]*?`;
                })
                .join('') + last;
        return new RegExp(str, 'g');
    }

    _matchScore(string, query, reg) {
        const length = query.length;
        if (length > string.length) return;

        const allMatches = string.toLowerCase().match(reg) || [];

        if (allMatches.length === 0) return;

        allMatches.sort((a, b) => a.length - b.length);

        return length - allMatches[0].length;
    }

    _matchString(string, query, { type, groupReg, reg }) {
        const stringLC = string.toLowerCase();
        if (type === 0) {
            return this._isLazyMatch(stringLC, query, groupReg, reg);
        }
        if (type === 1) {
            return stringLC === query;
        }
        if (type === 2) {
            return stringLC.startsWith(query);
        }
        if (type === 3) {
            return stringLC.endsWith(query);
        }
        return false;
    }

    _findMethods(
        className,
        methodString,
        matchOptions,
        languageId,
        symbols,
        doneMethods,
        checkParents,
        max
    ) {
        const classData = this.getClassData(className, languageId);
        if (!classData) return;

        for (const [methodName, methodData] of Object.entries(classData.methods)) {
            const name = `${className}.${methodName}`;

            if (
                !doneMethods.includes(name) &&
                this._matchString(methodName, methodString, matchOptions)
            ) {
                const sym = this.getMethodSymbol(name, methodData);

                symbols.push(sym);
                doneMethods.push(name);

                if (symbols.length === max) return;
            }
        }

        if (checkParents) {
            for (const parentClassName of this.getParents(className, languageId)) {
                this._findMethods(
                    parentClassName,
                    methodString,
                    matchOptions,
                    languageId,
                    symbols,
                    doneMethods,
                    true,
                    max
                );

                if (symbols.length === max) return;
            }
        }
    }

    _findInheritedMethods(
        className,
        methodString,
        matchOptions,
        languageId,
        symbols,
        doneMethods,
        max
    ) {
        for (const parentClassName of this.getParents(className, languageId)) {
            this._findMethods(
                parentClassName,
                methodString,
                matchOptions,
                languageId,
                symbols,
                doneMethods,
                false,
                max
            );
            if (symbols.length >= max) return;

            this._findInheritedMethods(
                parentClassName,
                methodString,
                matchOptions,
                languageId,
                symbols,
                doneMethods,
                max
            );
            if (symbols.length >= max) return;
        }
    }

    _findClasses(
        classString,
        matchOptions,
        symbols,
        max,
        { searchAll = false, languageIds = ['javascript', 'python'] }
    ) {
        const includeESOutside = this._includeESOutsideWorkspace();

        for (const [className, classData] of this.allClasses()) {
            if (!languageIds.includes(classData.languageId)) continue;

            // Only match myw classes or classes that are not in the workspace.
            if (
                (searchAll || !classData.es || (includeESOutside && !classData.workspace)) &&
                this._matchString(className, classString, matchOptions)
            ) {
                const sym = this.getClassSymbol(className, classData);

                symbols.push(sym);

                if (symbols.length === max) return;
            }
        }
    }

    _findExported(
        methodString,
        matchOptions,
        symbols,
        max,
        { searchAll = false, languageIds = ['javascript', 'python'] }
    ) {
        for (const methodData of this.allExportedFunctions()) {
            if (!languageIds.includes(methodData.languageId)) continue;

            const methodName = methodData.name;
            // Only match exported functions that are not in the workspace.
            if (
                (searchAll || !methodData.workspace) &&
                this._matchString(methodName, methodString, matchOptions)
            ) {
                const sym = this.getMethodSymbol(methodName, methodData);

                symbols.push(sym);

                if (symbols.length === max) return;
            }
        }
    }

    _findFiles(query, symbols, max) {
        const symbolFileNames = symbols.map((sym) => sym._fileName);

        const groupReg = this._lazyMatchGroupReg(query);
        const reg = this._lazyMatchReg(query);

        for (const fileName of this.allFiles) {
            if (
                !symbolFileNames.includes(fileName) &&
                this._isLazyMatch(fileName.toLowerCase(), query, groupReg, reg)
            ) {
                const sym = this.getFileSymbol(fileName);

                symbols.push(sym);
                symbolFileNames.push(fileName);

                if (symbols.length === max) return;
            }
        }
    }

    _sortSymbols(classString, methodString, symbols) {
        const origQuery = classString ? `${classString}.${methodString}` : methodString;
        const reg = this._lazyMatchReg(origQuery);
        const methodReg = new RegExp(`^${methodString}(\\(\\))?$`, 'i');

        symbols.sort((a, b) => {
            const orderA = a._order;
            const orderB = b._order;

            if (orderA === orderB) {
                let scoreA, scoreB;

                if (classString) {
                    scoreA = this._matchScore(a.name, origQuery, reg);
                }
                if (scoreA === undefined && a._methodName) {
                    if (methodReg.test(a._methodName)) {
                        scoreA = 1;
                    } else {
                        scoreA = this._matchScore(a._methodName, methodString, reg);
                    }
                }
                scoreA = Math.max(
                    this._matchScore(a._fileName, origQuery, reg) ?? -10000,
                    scoreA ?? -10000
                );

                if (classString) {
                    scoreB = this._matchScore(b.name, origQuery, reg);
                }
                if (scoreB === undefined && b._methodName) {
                    if (methodReg.test(b._methodName)) {
                        scoreB = 1;
                    } else {
                        scoreB = this._matchScore(b._methodName, methodString, reg);
                    }
                }
                scoreB = Math.max(
                    this._matchScore(b._fileName, origQuery, reg) ?? -10000,
                    scoreB ?? -10000
                );

                if (scoreA === scoreB) {
                    return a.name.localeCompare(b.name);
                }

                if (scoreA > scoreB) {
                    return -1;
                }
                return 1;
            }

            return orderA - orderB;
        });
    }

    getSymbols(
        query,
        {
            inheritOnly = false,
            localOnly = false,
            searchClasses = false,
            max = undefined,
            searchAll = false,
            languageIds = ['javascript', 'python'],
        }
    ) {
        if (max === undefined) {
            max = vscode.workspace.getConfiguration('iqgeo-utils-vscode').maxSearchResults || 500;
        }

        const queryString = query.replace(/\s+/g, '');
        const queryParts = queryString.split('.');

        let classString;
        let methodString;
        let classMatchType = 0;
        let methodMatchType = 0;

        if (queryParts.length > 2) {
            methodString = queryString;
        } else if (queryParts.length > 1) {
            classString = queryParts[0];
            methodString = queryParts[1];
        } else {
            methodString = queryParts[0];
        }

        if (classString) {
            if (classString[0] === '^' && classString[classString.length - 1] === '$') {
                classMatchType = 1;
                classString = classString.substring(1, classString.length - 1);
            } else if (classString[0] === '^') {
                classMatchType = 2;
                classString = classString.substring(1, classString.length);
            } else if (classString[classString.length - 1] === '$') {
                classMatchType = 3;
                classString = classString.substring(0, classString.length - 1);
            }
        }
        if (methodString[0] === '^' && methodString[methodString.length - 1] === '$') {
            methodMatchType = 1;
            methodString = methodString.substring(1, methodString.length - 1);
        } else if (methodString[0] === '^') {
            methodMatchType = 2;
            methodString = methodString.substring(1, methodString.length);
        } else if (methodString[methodString.length - 1] === '$') {
            methodMatchType = 3;
            methodString = methodString.substring(0, methodString.length - 1);
        }

        const symbols = [];

        if (queryParts.length < 3 && (classString?.length > 1 || methodString.length > 1)) {
            const doneMethods = [];
            const checkParents = classString && !localOnly;
            const includeESOutside = this._includeESOutsideWorkspace();

            const classMatchOptions = classString
                ? {
                      type: classMatchType,
                      groupReg: this._lazyMatchGroupReg(classString),
                      reg: this._lazyMatchReg(classString),
                  }
                : undefined;
            const methodMatchOptions = {
                type: methodMatchType,
                groupReg: this._lazyMatchGroupReg(methodString),
                reg: this._lazyMatchReg(methodString),
            };

            for (const [className, classData] of this.allClasses()) {
                if (!languageIds.includes(classData.languageId)) continue;

                if (
                    (classString && this._matchString(className, classString, classMatchOptions)) ||
                    (!classString &&
                        (searchAll || !classData.es || (includeESOutside && !classData.workspace)))
                ) {
                    if (inheritOnly) {
                        this._findInheritedMethods(
                            className,
                            methodString,
                            methodMatchOptions,
                            classData.languageId,
                            symbols,
                            doneMethods,
                            max
                        );
                    } else {
                        this._findMethods(
                            className,
                            methodString,
                            methodMatchOptions,
                            classData.languageId,
                            symbols,
                            doneMethods,
                            checkParents,
                            max
                        );
                    }

                    if (symbols.length >= max) break;
                }
            }

            if (searchClasses && !classString && symbols.length < max) {
                this._findClasses(methodString, methodMatchOptions, symbols, max, {
                    searchAll,
                    languageIds,
                });
            }

            if (!classString && symbols.length < max) {
                this._findExported(methodString, methodMatchOptions, symbols, max, {
                    searchAll,
                    languageIds,
                });
            }
        }

        if (searchAll && queryString.length > 2 && symbols.length < max) {
            this._findFiles(queryString, symbols, max);
        }

        this._sortSymbols(classString, methodString, symbols);

        return symbols;
    }

    provideWorkspaceSymbols(query) {
        return this.getSymbols(query.toLowerCase(), { searchClasses: true });
    }

    getSymbolsForFile(fileName) {
        const symbols = [];

        for (const [className, classData] of this.allClasses()) {
            if (classData.fileName === fileName) {
                const classSym = this.getClassSymbol(className, classData);
                symbols.push(classSym);

                for (const [methodName, methodData] of Object.entries(classData.methods)) {
                    const name = `${className}.${methodName}`;
                    const sym = this.getMethodSymbol(name, methodData);
                    symbols.push(sym);
                }
            }
        }

        for (const methodData of this.allExportedFunctions()) {
            if (methodData.fileName === fileName) {
                const sym = this.getMethodSymbol(methodData.name, methodData);
                symbols.push(sym);
            }
        }

        symbols.sort((a, b) => {
            return a.location.range.start.line - b.location.range.start.line;
        });

        return symbols;
    }

    // Read all files from defined search paths
    updateClasses() {
        this.classes = new Map();
        this.parents = new Map();
        this.exportedFunctions = new Map();
        this.esClasses = [];
        this.rootFolders = [];
        this.allFiles = new Set();

        for (const searchDir of this._getSearchPaths()) {
            const startTime = new Date().getTime();
            let nFiles = 0;

            if (fs.existsSync(searchDir)) {
                const finder = find(searchDir);

                finder.on('directory', (dir, stat, stop) => {
                    const base = path.basename(dir);
                    if (
                        IGNORE_DIRS.find((ignore) =>
                            ignore instanceof RegExp ? ignore.test(dir) : ignore === base
                        )
                    ) {
                        stop();
                    }
                });

                finder.on('file', (file) => {
                    const base = path.basename(file);
                    if (
                        IGNORE_FILES.find((ignore) =>
                            ignore instanceof RegExp ? ignore.test(file) : ignore === base
                        )
                    ) {
                        return;
                    }

                    const parts = base.split('.');
                    const ext = parts[parts.length - 1];
                    for (const config of this._languageConfig) {
                        if (config.extension === ext) {
                            nFiles++;
                            config.searchEngine.updateClasses(file);
                            this._updateRootFolders(file);
                            break;
                        }
                    }
                    this.allFiles.add(file);
                });

                finder.on('end', () => {
                    const searchTime = new Date().getTime() - startTime;
                    const msg = `Search complete: ${searchDir} (${nFiles} files in ${searchTime} ms)`;

                    vscode.window.showInformationMessage(msg);

                    this._generateSearchSummary();

                    this.linter.checkOpenFiles();

                    this.watchManager.start();
                });
            }
        }
    }

    updateClassesForDoc(doc, useDocLines = false) {
        const { languageId } = doc;
        for (const config of this._languageConfig) {
            if (config.languageId === languageId) {
                try {
                    const fileLines = useDocLines ? Utils.getDocLines(doc) : undefined;
                    this.clearDataForFile(doc.fileName);
                    config.searchEngine.updateClasses(doc.fileName, fileLines);
                } catch (error) {
                    this.outputChannel.error(util.format(error));
                }
                break;
            }
        }
    }

    _generateSearchSummary() {
        const { searchSummary } = vscode.workspace.getConfiguration('iqgeo-utils-vscode');
        if (searchSummary || this.debug) {
            const exportedFunctions = this.allExportedFunctions();
            const mywClasses = new Map();
            let classesTotal = 0;
            let symbolsTotal = 0;

            for (const [className, data] of this.allClasses()) {
                if (data.languageId === 'javascript' && !data.es) {
                    mywClasses.set(className, data);
                }
                classesTotal++;
                symbolsTotal += Object.keys(data.methods).length;
            }

            symbolsTotal += exportedFunctions.length;

            const summary = {
                searchPaths: this._getSearchPaths(),
                symbolsTotal,
                classesTotal,
                exportedFunctionsTotal: exportedFunctions.length,
                classes: this.classes,
                exportedFunctions,
                parents: this.parents,
                esClasses: this.esClasses,
                mywClasses,
            };

            if (searchSummary) {
                this._showSearchSummary(summary);
            } else {
                this.outputChannel.info(util.format(summary));
            }
        }
    }

    _showSearchSummary(summary) {
        const filterInfo = (data, props = ['fileName', 'methods']) => {
            const newData = [];
            const iter = data instanceof Map ? data : Object.entries(data);

            for (const [key, data] of iter) {
                const name = !isNaN(key) ? data.name : key;
                const values = Array.isArray(data) ? data : [data];

                for (const value of values) {
                    const newValue = { name };
                    for (const prop of props) {
                        const v = value[prop];
                        if (v) {
                            if (typeof v === 'object') {
                                newValue[prop] = filterInfo(v, props);
                            } else if (prop === 'fileName') {
                                newValue[prop] = `${v}:${value.line + 1}`; // :${value.index + 1}`;
                            } else {
                                newValue[prop] = v;
                            }
                        }
                    }
                    newData.push(newValue);
                }
            }

            return newData;
        };

        const info = {
            searchPaths: summary.searchPaths,
            symbolsTotal: summary.symbolsTotal,
            classesTotal: summary.classesTotal,
            esClassesTotal: summary.esClasses.length,
            exportedFunctionsTotal: summary.exportedFunctionsTotal,
            classes: filterInfo(summary.classes),
            mywClasses: filterInfo(summary.mywClasses),
            exportedFunctions: filterInfo(summary.exportedFunctions),
            parents: summary.parents,
            esClasses: summary.esClasses,
        };

        this.outputChannel.info(util.format(info));
        this.outputChannel.show(true);
    }

    addClassData(className, data) {
        const key = `${className}:${data.languageId}`;
        this.classes.set(key, data);
        this.parents.delete(key);
    }

    getClassData(className, languageId = 'javascript') {
        const key = `${className}:${languageId}`;
        return this.classes.get(key);
    }

    *allClasses() {
        for (const [key, data] of this.classes) {
            yield [key.split(':')[0], data];
        }
    }

    addParents(className, parents, languageId = 'javascript') {
        const key = `${className}:${languageId}`;
        this.parents.set(key, parents);
    }

    addParent(className, parent, languageId = 'javascript') {
        if (!parent) return;
        const key = `${className}:${languageId}`;
        const parents = this.parents.get(key) || [];
        if (!parents.includes(parent)) {
            parents.push(parent);
        }
        this.parents.set(key, parents);
    }

    getParents(className, languageId = 'javascript') {
        const key = `${className}:${languageId}`;
        return this.parents.get(key) || [];
    }

    getSubTypes(className, languageId = 'javascript') {
        const subTypes = [];
        for (const key of this.classes.keys()) {
            const [name, id] = key.split(':');
            if (id === languageId) {
                const parents = this.parents.get(key) || [];
                if (parents.includes(className)) {
                    subTypes.push(name);
                }
            }
        }
        return subTypes;
    }

    addExportedFunction(functionName, data) {
        const key = `${functionName}:${data.languageId}`;
        let allData = this.exportedFunctions.get(key);

        if (!allData) {
            allData = [];
            this.exportedFunctions.set(key, allData);
        }

        data.name = `${functionName}()`;
        data.kind = vscode.SymbolKind.Function;
        allData.push(data);
    }

    getExportedFunctions(functionName, languageId = 'javascript') {
        const key = `${functionName}:${languageId}`;
        return this.exportedFunctions.get(key) || [];
    }

    allExportedFunctions() {
        const allData = [];
        for (const dataArray of this.exportedFunctions.values()) {
            allData.push(...dataArray);
        }
        return allData;
    }

    clearDataForFile(fileName) {
        for (const [key, data] of this.classes) {
            if (data.fileName === fileName) {
                this.classes.delete(key);
                this.parents.delete(key);
            }
        }

        for (const [key, dataArray] of this.exportedFunctions) {
            if (dataArray.find((data) => data.fileName === fileName)) {
                const newData = dataArray.filter((data) => data.fileName !== fileName);
                if (newData.length === 0) {
                    this.exportedFunctions.delete(key);
                } else {
                    this.exportedFunctions.set(key, newData);
                }
            }
        }
    }

    _getNamedImports(doc) {
        const imports = [];
        const fileLines = Utils.getDocLines(doc);
        const len = fileLines.length;
        let line = 0;

        while (line < len) {
            const str = fileLines[line];

            if (str.trim().length === 0) {
                line++;
                continue;
            }

            let match = str.match(IMPORT_REG);

            if (!match) {
                match = str.match(IMPORT_MULTI_LINE_REG);
                if (match) {
                    match = Utils.matchMultiLine(
                        str,
                        line,
                        fileLines,
                        IMPORT_MULTI_LINE_REG,
                        IMPORT_REG
                    );
                }
            }

            if (match) {
                if (match[1] !== '') {
                    imports.push(match[1]);
                }
                if (match[2] !== '') {
                    imports.push(...match[2].split(',').map((name) => name.trim()));
                }
            } else if (imports.length && !/^\s*[/*]/.test(str)) {
                break;
            }

            line++;
        }

        return imports;
    }

    _getCurrentFunctionData(className, doc, currentLine) {
        const classData = this.getClassData(className);
        if (!classData) return;

        const methodData = classData.methods;
        const { fileName } = doc;

        const reverseOrder = Object.keys(methodData).sort(
            (nameA, nameB) => methodData[nameB].line - methodData[nameA].line
        );

        for (const name of reverseOrder) {
            const data = methodData[name];
            if (data.fileName === fileName && data.line <= currentLine) {
                return data;
            }
        }
    }

    _updateRootFolders(fileName) {
        const folder = path.dirname(fileName);
        let add = true;

        for (const [index, root] of Object.entries(this.rootFolders)) {
            const len = root.length;
            let i = 0;

            while (i < len && root.charAt(i) === folder.charAt(i)) i++;

            if (i > 0) {
                if (i !== len) {
                    this.rootFolders.splice(index, 1, root.substring(0, i));
                }
                add = false;
                break;
            }
        }

        if (add) {
            this.rootFolders.push(folder);
        }
    }

    _inTestFolder(data) {
        let { test } = data;
        if (test === undefined) {
            test = this._isTestFile(data.fileName);
            data.test = test;
        }
        return test;
    }

    _isTestFile(fileName) {
        return /[/]tests?[/]/.test(fileName);
    }

    isWorkspaceFile(fileName) {
        const workspaceFolder = this.getWorkspaceFolder();
        return workspaceFolder && fileName.startsWith(workspaceFolder);
    }

    getWorkspaceFolder() {
        if (!this.workspaceFolder && vscode.workspace.workspaceFolders) {
            this.workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
        return this.workspaceFolder;
    }

    _getSearchPaths() {
        let paths = vscode.workspace.getConfiguration('iqgeo-utils-vscode').searchPaths || '';
        if (!paths.length && vscode.workspace.workspaceFolders) {
            paths = this.getWorkspaceFolder();
            if (paths.startsWith('/opt/iqgeo/platform/WebApps/myworldapp')) {
                paths = '/opt/iqgeo/platform/WebApps/myworldapp'; // in container so include platform source by default
            }
        }
        paths = paths.split(';');
        return paths;
    }

    _includeESOutsideWorkspace() {
        return (
            vscode.workspace.getConfiguration('iqgeo-utils-vscode').includeESOutsideWorkspace ||
            false
        );
    }
}
