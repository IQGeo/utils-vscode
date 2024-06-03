import vscode from 'vscode'; // eslint-disable-line

const LAYOUT_CONFIG = [
    {
        name: 'sidebarAndEditorAndTerminal',
        commands: [
            'workbench.action.focusSideBar',
            'workbench.files.action.showActiveFileInExplorer',
            'workbench.action.positionPanelBottom',
            'workbench.action.terminal.focus',
            'workbench.action.focusActiveEditorGroup',
        ],
    },
    {
        name: 'editorAndTerminal',
        commands: [
            'workbench.action.closeSidebar',
            'workbench.action.positionPanelBottom',
            'workbench.action.terminal.focus',
            'workbench.action.focusActiveEditorGroup',
        ],
    },
    {
        name: 'sidebarAndEditor',
        commands: [
            'workbench.action.terminal.focus',
            'workbench.action.terminal.toggleTerminal',
            'workbench.action.focusSideBar',
        ],
    },
    {
        name: 'explorerAndEditor',
        commands: [
            'workbench.action.terminal.focus',
            'workbench.action.terminal.toggleTerminal',
            'workbench.action.focusSideBar',
            'workbench.files.action.showActiveFileInExplorer',
        ],
    },
    {
        name: 'sourceControlAndEditor',
        commands: [
            'workbench.action.terminal.focus',
            'workbench.action.terminal.toggleTerminal',
            'workbench.action.focusSideBar',
            'workbench.view.scm',
        ],
    },
    {
        name: 'editorAndTerminalRight',
        commands: [
            'workbench.action.closeSidebar',
            'workbench.action.positionPanelRight',
            'workbench.action.terminal.focus',
            'workbench.action.focusActiveEditorGroup',
        ],
    },
    {
        name: 'editorOnly',
        commands: [
            'workbench.action.terminal.focus',
            'workbench.action.terminal.toggleTerminal',
            'workbench.action.closeSidebar',
            'workbench.action.focusActiveEditorGroup',
        ],
    },
    {
        name: 'editorGroup',
        commands: [
            'workbench.action.focusActiveEditorGroup',
            'workbench.action.toggleMaximizeEditorGroup',
        ],
    },
];

/**
 * Provide workspace layout commands for the IQGeo extension.
 */
export class IQGeoLayout {
    constructor(context) {
        if (vscode.workspace.getConfiguration('iqgeo-utils-vscode').enableLayouts) {
            this._addLayouts(context);
        }

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.toggleTerminalFocus', async (args) => {
                await this._toggleTerminalFocus(args.editorFocus);
            })
        );
    }

    _addLayouts(context) {
        for (const layout of LAYOUT_CONFIG) {
            const disposable = vscode.commands.registerCommand(`iqgeo.${layout.name}`, async () => {
                for (const commandName of layout.commands) {
                    await vscode.commands.executeCommand(commandName);
                }
            });
            context.subscriptions.push(disposable);
        }
    }

    async _toggleTerminalFocus(editorFocus) {
        if (vscode.workspace.getConfiguration('iqgeo-utils-vscode').resizeTerminal) {
            if (editorFocus) {
                await vscode.commands.executeCommand('workbench.action.terminal.resizePaneUp');
            } else {
                await vscode.commands.executeCommand('workbench.action.terminal.resizePaneDown');
            }
        }

        if (editorFocus) {
            await vscode.commands.executeCommand('workbench.action.terminal.focus');
        } else {
            await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        }
    }
}
