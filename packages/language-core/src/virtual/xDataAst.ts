import * as ts from "typescript";

export interface DataMemberDescriptor {
    name: string;
    kind: "property" | "method" | "shorthand" | "init" | "getter" | "setter";
    type: ts.TypeNode | undefined;
    text: string;
    initializerText: string | undefined;
    /** Offset of the property name start in the source value. */
    nameRange: { start: number; end: number };
    /** Offset of the property initializer in the source value. */
    initializerRange?: { start: number; end: number };
    /** Offset of the method/getter/setter body in the source value. */
    bodyRange?: { start: number; end: number };
    paramsText?: string;
    bodyText?: string;
    isAsync?: boolean;
    isGenerator?: boolean;
    parameters?: DataMemberParameterDescriptor[];
    jsDocReturnTypeText?: string;
}

export interface DataMemberParameterDescriptor {
    name: string;
    isRest?: boolean;
    hasDefault?: boolean;
    jsDocTypeText?: string;
}

export interface DataParseResult {
    members: DataMemberDescriptor[];
    parseError: boolean;
}

/**
 * Parse the value of `x-data="..."` as a JavaScript object literal.
 *
 * Anything that fails to parse (functions, identifiers, anything other than an
 * `{...}` literal) returns an empty member list and a parseError flag — caller
 * decides whether to fall back to a generic `unknown` view.
 */
export function parseDataLiteral(value: string): DataParseResult {
    if (!value.trim().startsWith("{")) {
        return { members: [], parseError: true };
    }
    const source = ts.createSourceFile(
        "alpine-xdata.ts",
        `(${value})`,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.JS,
    );
    let parseError = false;
    const members: DataMemberDescriptor[] = [];

    function visit(node: ts.Node): void {
        if (parseError) {
            return;
        }
        let candidate: ts.Node = node;
        while (ts.isExpressionStatement(candidate) || ts.isParenthesizedExpression(candidate)) {
            candidate = ts.isExpressionStatement(candidate)
                ? candidate.expression
                : (candidate as ts.ParenthesizedExpression).expression;
        }
        const objLiteral = pickObjectLiteral(candidate);
        if (!objLiteral) {
            parseError = true;
            return;
        }
        for (const prop of objLiteral.properties) {
            const member = describe(prop);
            if (member) {
                members.push(member);
            } else {
                parseError = true;
                return;
            }
        }
    }

    for (const stmt of source.statements) {
        visit(stmt);
        if (parseError) {
            break;
        }
    }
    return { members, parseError };
}

function pickObjectLiteral(node: ts.Node): ts.ObjectLiteralExpression | undefined {
    if (ts.isParenthesizedExpression(node)) {
        return pickObjectLiteral(node.expression);
    }
    if (ts.isObjectLiteralExpression(node)) {
        return node;
    }
    return undefined;
}

function describe(prop: ts.ObjectLiteralElement): DataMemberDescriptor | undefined {
    if (ts.isPropertyAssignment(prop)) {
        const nameNode = prop.name;
        const range = textRangeOf(nameNode);
        const name = getName(nameNode);
        if (!name) {
            return undefined;
        }
        return {
            name,
            kind: "property",
            type: undefined,
            text: prop.getText(),
            initializerText: prop.initializer.getText(),
            nameRange: range,
            initializerRange: textRangeOf(prop.initializer),
        };
    }
    if (ts.isShorthandPropertyAssignment(prop)) {
        const range = textRangeOf(prop.name);
        return {
            name: prop.name.text,
            kind: "shorthand",
            type: undefined,
            text: prop.getText(),
            initializerText: prop.name.text,
            nameRange: range,
        };
    }
    if (ts.isMethodDeclaration(prop)) {
        const range = textRangeOf(prop.name);
        const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : undefined;
        if (!name) {
            return undefined;
        }
        const jsDoc = extractJsDocInfo(prop);
        return {
            name,
            kind: name === "init" ? "init" : "method",
            type: undefined,
            text: prop.getText(),
            initializerText: undefined,
            nameRange: range,
            bodyRange: prop.body ? textRangeOf(prop.body) : undefined,
            paramsText: prop.parameters.map((param) => param.getText()).join(", "),
            bodyText: prop.body?.getText(),
            isAsync: hasAsyncModifier(prop),
            isGenerator: Boolean(prop.asteriskToken),
            parameters: describeParameters(prop.parameters, jsDoc.paramTypes),
            jsDocReturnTypeText: jsDoc.returnTypeText,
        };
    }
    if (ts.isGetAccessor(prop)) {
        const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : undefined;
        if (!name) {
            return undefined;
        }
        const jsDoc = extractJsDocInfo(prop);
        return {
            name,
            kind: "getter",
            type: undefined,
            text: prop.getText(),
            initializerText: undefined,
            nameRange: textRangeOf(prop.name),
            bodyRange: prop.body ? textRangeOf(prop.body) : undefined,
            bodyText: prop.body?.getText(),
            jsDocReturnTypeText: jsDoc.returnTypeText,
        };
    }
    if (ts.isSetAccessor(prop)) {
        const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : undefined;
        if (!name) {
            return undefined;
        }
        const jsDoc = extractJsDocInfo(prop);
        return {
            name,
            kind: "setter",
            type: undefined,
            text: prop.getText(),
            initializerText: undefined,
            nameRange: textRangeOf(prop.name),
            bodyRange: prop.body ? textRangeOf(prop.body) : undefined,
            paramsText: prop.parameters.map((param) => param.getText()).join(", "),
            bodyText: prop.body?.getText(),
            parameters: describeParameters(prop.parameters, jsDoc.paramTypes),
            jsDocReturnTypeText: jsDoc.returnTypeText,
        };
    }
    return undefined;
}

function describeParameters(
    parameters: readonly ts.ParameterDeclaration[],
    jsDocParamTypes: ReadonlyMap<string, string>,
): DataMemberParameterDescriptor[] {
    return parameters.map((parameter) => {
        const name = ts.isIdentifier(parameter.name) ? parameter.name.text : parameter.name.getText();
        return {
            name,
            isRest: Boolean(parameter.dotDotDotToken),
            hasDefault: Boolean(parameter.initializer),
            jsDocTypeText: jsDocParamTypes.get(name),
        };
    });
}

function extractJsDocInfo(node: ts.Node): {
    paramTypes: ReadonlyMap<string, string>;
    returnTypeText?: string;
} {
    const paramTypes = new Map<string, string>();
    let returnTypeText: string | undefined;
    for (const tag of ts.getJSDocTags(node)) {
        if (ts.isJSDocParameterTag(tag) && tag.name) {
            const typeText = tag.typeExpression?.type?.getText();
            if (typeText) {
                paramTypes.set(tag.name.getText(), typeText);
            }
        }
        if (ts.isJSDocReturnTag(tag)) {
            const typeText = tag.typeExpression?.type?.getText();
            if (typeText) {
                returnTypeText = typeText;
            }
        }
    }
    return { paramTypes, returnTypeText };
}

function textRangeOf(node: ts.Node): { start: number; end: number } {
    return {
        start: Math.max(0, node.getStart() - 1),
        end: Math.max(0, node.getEnd() - 1),
    };
}

function getName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
        return name.text;
    }
    if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    if (ts.isComputedPropertyName(name)) {
        return undefined;
    }
    return undefined;
}

function hasAsyncModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
}
