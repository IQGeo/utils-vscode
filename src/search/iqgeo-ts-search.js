import { IQGeoJSSearch } from './iqgeo-js-search.js';

export class IQGeoTSSearch extends IQGeoJSSearch {
    classReg =
        /^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)\s+(?:extends|implements)?.*?(\w+)?\s*{/;
    namespaceClassReg = /(?:\w+)\s*=\s*class\s+(\w+)\s+(?:extends|implements)?.*?(\w+)?\s*\)?\s*{/;
    namespaceClassMultiLineReg = /(?:\w+)\s*=\s*class\s+(\w+)\s+(?:extends|implements)\s*\(?/;

    propertyReg =
        /^\s*(?:static\s+|public\s+|private\s+|protected\s+|readonly\s+|#)*(\w+)\??(:|\s*=)/;
    setterOrGetterReg =
        /^\s*(?:public\s+|private\s+|protected\s+|readonly\s+|#)*(?:(?:set|get)\s+)(\w+)\s*\(/;
    functionReg =
        /^\s*(?:async\s+|static\s+|public\s+|private\s+|protected\s+|#)*\*?(\w+)(?:<.*?>)?\s*\((.*?)\)(?:\s*:\s*.+?)?\s*{/;
    functionMultiLineReg =
        /^\s*(async\s*|static\s*|public\s+|private\s+|protected\s+|#)*\*?\w+\s*(\(|<)\s*$/;

    constructor(iqgeoVSCode) {
        super(iqgeoVSCode);
        this.languageId = 'typescript';
    }
}
