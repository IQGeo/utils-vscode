<style>
    .heading-container {
        display: flex;
        align-items: center;
        column-gap: 15px;
    }
    .heading {
        border-bottom: 0;
        margin-top: 0.3em;
        margin-bottom: 0;
    }
</style>

<div class="heading-container">
    <img src="./images/iqgeo_logo.png"/>
    <h1 class="heading">IQGeo VS Code Utils</h1>
</div>

<br>
IQGeo development extension to support code navigation and additional linting in Visual Studio Code.

The extension provides the following features:

1. An alternative definition search dialog that shows a preview of the highlighted result in an editor.<br>
    The search supports JavaScript and Python and accepts these query formats:
    -   \<method name\>
    -   \<class name\>
    -   \<class name\>.\<method name\>
    -   @\<path name\>

<img src="./images/def_search_app.png" width="850"/>

2. Enhanced navigation to the definitions using the standard commands in VS Code. (e.g. Go to Definition, Peek Definition, Go to Symbol, ...).<br>

3. Linting for API usage and subclassing.

4. Set of shortcuts for definition search, code navigation and text search.

<br>
The extension scans for definitions in the paths specified by the setting iqgeo-utils-vscode.searchPaths (see below).<br>
Files are automatically rescanned when saved.

## Usage

### Definition Search
-   Search Definitions = **CMD + T** (**Alt + T**).<br>
    The search supports \<method name\> or \<class name\> or \<class\>.\<method\><br>
    Use \<class name\>. to list all functions for a class.<br>
    Use @\<partial path\> to list classes matching the path.<br>

    The search is case-insensitive. Matching inherited methods are shown in results.<br>

    Use the up and down arrows in the search result list to update the preview.

-   Scan Files (IQGeo Refresh Symbols) = **Ctrl + T**<br>
    (e.g. after changing branch)

### Text Search
-   Search in the root folder = **CMD + G** (**Ctrl + G**)

-   Search in the workspace (repository) folder = **CMD + R** (**Ctrl + R**)

-   Open Editor Search with current selection or word = **Ctrl + G** (**Alt + G**)

### Navigation
-   Go to Definition = **CMD + Right** (**Ctrl + Right**)

-   Go Back = **CMD + Left** (**Ctrl + Left**)

-   Definition search with current selection or word = **OPT + Up** (**Ctrl + Up**)

-   Peek Definition = **OPT + Down** (**Ctrl + Down**)

-   Go Forward = **Shift + CMD + Right** (**Shift + Ctrl + Right**)

<br>

-   Definition Up = **CMD + PageUp** (**Ctrl + PageUp**)

-   Definition Down = **CMD + PageDown** (**Ctrl + PageDown**)

<br>

-   Reveal current file in Explorer = **CMD + E** (**Ctrl + E**)

-   Toggle Editor/Terminal Focus = **CMD + '** (**Ctrl + '**)

-   Toggle terminal visibility = **Ctrl + '** (**Alt + '**)

## Extension Settings

-   Search paths for JS and Python definitions. Use ; to separate paths. (Default value is the VS Code workspace folder path)
    ```json
    "iqgeo-utils-vscode.searchPaths": "/opt/iqgeo/platform/WebApps"
    ```
-   Maximum number of search results displayed by this extension. (Default value is 500)
    ```json
    "iqgeo-utils-vscode.maxSearchResults": 500
    ```
-   Defines whether a preview of the active result in the search list is shown. (Default value is true)
    ```json
    "iqgeo-utils-vscode.enableSearchPreview": true
    ```
-   Defines whether API and subclassing linting is enabled. (Default value is true)
    ```json
    "iqgeo-utils-vscode.enableLinting": true
    ```

## Release Notes

### 1.0.0
-   Initial release of iqgeo-utils-vscode to support code navigation and linting.
