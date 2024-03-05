const vscode = require('vscode'); // eslint-disable-line
const fs = require('fs');

const INVALID_NAME_CHAR = /[^\w]/;

function getFileLines(fileName) {
    if (!fileName || fileName === '') return;

    try {
        fs.accessSync(fileName, fs.constants.R_OK);
    } catch (err) {
        return;
    }

    let openDoc;

    for (const doc of vscode.workspace.textDocuments) {
        if (doc.fileName === fileName) {
            if (doc.isDirty) {
                // Use lines from unsaved editor
                return getDocLines(doc);
            }
            openDoc = doc;
            break;
        }
    }

    let lines;
    if (openDoc) {
        lines = getDocLines(openDoc);
    } else {
        try {
            lines = fs.readFileSync(fileName).toString().split('\n');
        } catch (err) {
            vscode.window.showWarningMessage(`Cannot open file: ${fileName}`);
            return;
        }
    }

    return lines;
}

function getDocLines(doc) {
    const lines = [];
    const linesLength = doc.lineCount;
    for (let i = 0; i < linesLength; i++) {
        lines.push(doc.lineAt(i).text);
    }
    return lines;
}

function removeStrings(str) {
    if (!/['"]/.test(str)) return str;

    const textLength = str.length;
    const noStrings = [];
    let quote = undefined;

    for (let i = 0; i < textLength; i++) {
        const c = str[i];
        if (quote) {
            if (c === quote) {
                quote = undefined;
            }
        } else if (c === '"' || c === "'") {
            quote = c;
        } else {
            noStrings.push(c);
        }
    }

    return noStrings.join('');
}

function removeLiterals(str, inLiteral = false) {
    if (str.indexOf('`') === -1) {
        if (inLiteral) {
            return ['', true];
        } else {
            return [str, false];
        }
    }

    const textLength = str.length;
    const noLiterals = [];

    for (let i = 0; i < textLength; i++) {
        const c = str[i];
        if (c === '`') {
            inLiteral = !inLiteral;
        } else if (!inLiteral) {
            noLiterals.push(c);
        }
    }

    return [noLiterals.join(''), inLiteral];
}

function removeComments(str, inComment = false) {
    const startStr = '/*';
    const endStr = '*/';
    let target = inComment ? endStr : startStr;
    let end = str.indexOf(target);

    if (end === -1) {
        if (inComment) {
            return ['', true];
        } else {
            return [str, false];
        }
    }

    const noComments = [];
    let start = 0;

    while (end !== -1) {
        if (inComment) {
            inComment = false;
            start = end + endStr.length;
            target = startStr;
        } else {
            inComment = true;
            noComments.push(str.substring(start, end));
            target = endStr;
        }

        end = str.indexOf(target, start);
    }

    if (!inComment) {
        noComments.push(str.substring(start));
    }

    return [noComments.join(''), inComment];
}

function removeLineComment(str) {
    let index = str.indexOf('//');
    while (index > -1) {
        if (!withinString(str, index)) {
            return str.substring(0, index);
        }
        index = str.indexOf('//', index + 2);
    }
    return str;
}

function withinString(str, index) {
    const chars = ['"', "'", '`'];
    let char;

    for (let i = 0; i < index; i++) {
        const c = str[i];
        if (chars.includes(c)) {
            if (char) {
                if (c === char) {
                    char = undefined;
                }
            } else {
                char = c;
            }
        }
    }
    return char !== undefined;
}

function previousWordInString(text, index) {
    const match = /(\w+)[^\w]*[\w]*$/.exec(text.substring(0, index));
    if (match) {
        return match[1];
    }
}

function previousWord(doc, pos) {
    return previousWordInString(doc.lineAt(pos.line).text, pos.character);
}

function currentWordInString(text, index) {
    const invalidIndex = text.slice(index).search(INVALID_NAME_CHAR);
    if (invalidIndex !== -1) {
        return previousWordInString(text, index + invalidIndex + 1);
    }

    const match = /\w+$/.exec(text);
    if (match) return match[0];
}

function currentWord(doc, pos) {
    return currentWordInString(doc.lineAt(pos.line).text, pos.character);
}

function selectedRange() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const { selection } = editor;

    if (
        selection.start.character !== selection.end.character ||
        selection.start.line !== selection.end.line
    ) {
        return new vscode.Range(selection.start, selection.end);
    }
}

function rangesEqual(rangeA, rangeB) {
    if (rangeA === undefined && rangeB === undefined) {
        return false;
    }
    if (
        (rangeA === undefined && rangeB !== undefined) ||
        (rangeA !== undefined && rangeB === undefined)
    ) {
        return false;
    }
    return rangeA.isEqual(rangeB);
}

function selectedText() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selRange = selectedRange();
    if (selRange) {
        return editor.document.getText(selRange);
    }
}

function matchMultiLine(str, line, fileLines, startReg, reg) {
    if (startReg.test(str)) {
        const max = Math.min(line + 16, fileLines.length);
        let testStr = str;
        let inComment = false;
        line++;

        while (line < max) {
            let lineStr = fileLines[line];
            [lineStr, inComment] = removeComments(lineStr, inComment);
            lineStr = lineStr.split('//')[0];

            if (!inComment) {
                testStr += lineStr;
                const match = testStr.match(reg);

                if (match) {
                    return match;
                }
            }

            line++;
        }
    }
}

function debounce(callback, wait) {
    let timeout;
    return (...args) => {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => callback.apply(context, args), wait);
    };
}

module.exports = {
    getFileLines,
    getDocLines,
    removeStrings,
    removeLiterals,
    removeComments,
    removeLineComment,
    previousWordInString,
    previousWord,
    currentWordInString,
    currentWord,
    selectedRange,
    rangesEqual,
    selectedText,
    matchMultiLine,
    debounce,
};
