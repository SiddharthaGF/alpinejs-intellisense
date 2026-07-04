/**
 * Categorises how a directive should interpret its value.
 *
 * The discriminator is intentionally coarse: it captures how the downstream
 * stage 4/5 machinery will treat the attribute payload.
 */
export type DirectiveValueKind =
    | "none"
    | "literal"
    | "selector"
    | "expression"
    | "statement"
    | "async-statement"
    | "assignable"
    | "data-object"
    | "for-expression"
    | "transition-classes";

export interface ModifierSpec {
    name: string;
    documentation: string;
}

export interface DirectiveSpec {
    name: string;
    aliases: string[];
    arguments: string[];
    modifiers: ModifierSpec[];
    valueKind: DirectiveValueKind;
    documentation: string;
}

const ALPINE_DOCS_ROOT = "https://alpinejs.dev";

const X_SHORTHANDS = ["@"] as const;
const BIND_SHORTHANDS = [":"] as const;

const ALL_ARGUMENTS = "*" as const;

const X_ON_MODIFIERS: ModifierSpec[] = [
    { name: "prevent", documentation: "Calls `event.preventDefault()`." },
    { name: "stop", documentation: "Calls `event.stopPropagation()`." },
    { name: "self", documentation: "Only fires when `event.target === $event.currentTarget`." },
    { name: "window", documentation: "Listens for the event on the window." },
    { name: "document", documentation: "Listens for the event on the document." },
    { name: "passive", documentation: "Marks the listener passive." },
    { name: "once", documentation: "The listener fires at most once." },
    { name: "outside", documentation: "Only fires when the event happens outside the element." },
    { name: "debounce", documentation: "Debounces the handler by the provided number of milliseconds." },
    { name: "throttle", documentation: "Throttles the handler by the provided number of milliseconds." },
    { name: "shift", documentation: "Only fires when `event.shiftKey` is true." },
    { name: "control", documentation: "Only fires when `event.controlKey` is true." },
    { name: "meta", documentation: "Only fires when `event.metaKey` is true." },
    { name: "alt", documentation: "Only fires when `event.altKey` is true." },
];

const X_BIND_MODIFIERS: ModifierSpec[] = [
    { name: "camel", documentation: "Converts the attribute name from kebab-case to camelCase." },
    { name: "attr", documentation: "Binds the raw value through `setAttribute`." },
];

const X_MODEL_MODIFIERS: ModifierSpec[] = [
    { name: "lazy", documentation: "Only syncs on the `change` event, not `input`." },
    { name: "number", documentation: "Coerces the value to a number." },
    { name: "trim", documentation: "Trims whitespace from the input value." },
    { name: "debounce", documentation: "Debounces the bound value by the provided milliseconds." },
    { name: "throttle", documentation: "Throttles the bound value by the provided milliseconds." },
];

const X_TRANSITION_MODIFIERS: ModifierSpec[] = [
    { name: "duration", documentation: "Custom durations for the transition phases." },
    { name: "delay", documentation: "Custom delays for the transition phases." },
    { name: "origin", documentation: "Custom `transform-origin` for the transition." },
    { name: "enter", documentation: "Custom enter classes." },
    { name: "leave", documentation: "Custom leave classes." },
    { name: "opacity", documentation: "Disable opacity phase animations." },
    { name: "scale", documentation: "Disable scale phase animations." },
];

export const DIRECTIVES: DirectiveSpec[] = [
    {
        name: "x-data",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "data-object",
        documentation:
            "Declares a new component scope. The expression must be a plain object expression that defines the component's data and methods.",
    },
    {
        name: "x-init",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "statement",
        documentation: "Evaluates the expression when the component initializes.",
    },
    {
        name: "x-show",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "expression",
        documentation: "Toggles `display: none` on the element based on the expression's truthiness.",
    },
    {
        name: "x-bind",
        aliases: [...BIND_SHORTHANDS],
        arguments: [ALL_ARGUMENTS],
        modifiers: X_BIND_MODIFIERS,
        valueKind: "expression",
        documentation:
            "Sets the value of an HTML attribute on the element to the result of evaluating the expression. Supports the `:` shorthand.",
    },
    {
        name: "x-on",
        aliases: [...X_SHORTHANDS],
        arguments: [ALL_ARGUMENTS],
        modifiers: X_ON_MODIFIERS,
        valueKind: "statement",
        documentation:
            "Attaches an event listener to the element. The argument names the event. Supports the `@` shorthand.",
    },
    {
        name: "x-text",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "expression",
        documentation: "Sets the element's `textContent` to the result of the expression.",
    },
    {
        name: "x-html",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "expression",
        documentation: "Sets the element's `innerHTML` to the result of the expression.",
    },
    {
        name: "x-model",
        aliases: [],
        arguments: [],
        modifiers: X_MODEL_MODIFIERS,
        valueKind: "assignable",
        documentation: "Binds the value of an input element to a component property (two-way binding).",
    },
    {
        name: "x-modelable",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "assignable",
        documentation: "Exposes the component property used by `x-model` so parents can bind to it.",
    },
    {
        name: "x-for",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "for-expression",
        documentation: "Iterates over an iterable expression. The element must be inside a `<template>`.",
    },
    {
        name: "x-transition",
        aliases: [],
        arguments: [],
        modifiers: X_TRANSITION_MODIFIERS,
        valueKind: "transition-classes",
        documentation: "Applies CSS transition classes when `x-show` toggles.",
    },
    {
        name: "x-effect",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "statement",
        documentation: "Re-evaluates the expression whenever any of its tracked dependencies change.",
    },
    {
        name: "x-ignore",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "none",
        documentation: "Tells Alpine to skip initialising this element and its children.",
    },
    {
        name: "x-ref",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "literal",
        documentation: "Registers the element with the provided name so it can be referenced later.",
    },
    {
        name: "x-cloak",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "none",
        documentation: "Removes the `x-cloak` attribute after Alpine initializes (used with the matching CSS rule).",
    },
    {
        name: "x-teleport",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "selector",
        documentation: "Teleports the element's template body to the provided CSS selector target.",
    },
    {
        name: "x-if",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "expression",
        documentation: "Conditionally renders the element (must be the only child of a `<template>`).",
    },
    {
        name: "x-id",
        aliases: [],
        arguments: [],
        modifiers: [],
        valueKind: "literal",
        documentation: "Generates a unique id once per page load and exposes it through `$id('<argument>')`.",
    },
];

export const ALPINE_SPEC_VERSION = "0.0.0" as const;

const canonicalIndex = new Map<string, DirectiveSpec>();
for (const directive of DIRECTIVES) {
    canonicalIndex.set(directive.name, directive);
}
const aliasIndex = new Map<string, DirectiveSpec>();
for (const directive of DIRECTIVES) {
    for (const alias of directive.aliases) {
        aliasIndex.set(alias, directive);
    }
}

const directiveReferenceIndex = new Map<string, string>([
    ["x-data", `${ALPINE_DOCS_ROOT}/directives/data`],
    ["x-init", `${ALPINE_DOCS_ROOT}/directives/init`],
    ["x-show", `${ALPINE_DOCS_ROOT}/directives/show`],
    ["x-bind", `${ALPINE_DOCS_ROOT}/directives/bind`],
    ["x-on", `${ALPINE_DOCS_ROOT}/directives/on`],
    ["x-text", `${ALPINE_DOCS_ROOT}/directives/text`],
    ["x-html", `${ALPINE_DOCS_ROOT}/directives/html`],
    ["x-model", `${ALPINE_DOCS_ROOT}/directives/model`],
    ["x-modelable", `${ALPINE_DOCS_ROOT}/directives/modelable`],
    ["x-for", `${ALPINE_DOCS_ROOT}/directives/for`],
    ["x-transition", `${ALPINE_DOCS_ROOT}/directives/transition`],
    ["x-effect", `${ALPINE_DOCS_ROOT}/directives/effect`],
    ["x-ignore", `${ALPINE_DOCS_ROOT}/directives/ignore`],
    ["x-ref", `${ALPINE_DOCS_ROOT}/directives/ref`],
    ["x-cloak", `${ALPINE_DOCS_ROOT}/directives/cloak`],
    ["x-teleport", `${ALPINE_DOCS_ROOT}/directives/teleport`],
    ["x-if", `${ALPINE_DOCS_ROOT}/directives/if`],
    ["x-id", `${ALPINE_DOCS_ROOT}/directives/id`],
]);

const magicReferenceIndex = new Map<string, string>([
    ["$el", `${ALPINE_DOCS_ROOT}/magics/el`],
    ["$refs", `${ALPINE_DOCS_ROOT}/magics/refs`],
    ["$store", `${ALPINE_DOCS_ROOT}/magics/store`],
    ["$watch", `${ALPINE_DOCS_ROOT}/magics/watch`],
    ["$dispatch", `${ALPINE_DOCS_ROOT}/magics/dispatch`],
    ["$nextTick", `${ALPINE_DOCS_ROOT}/magics/nextTick`],
    ["$root", `${ALPINE_DOCS_ROOT}/magics/root`],
    ["$data", `${ALPINE_DOCS_ROOT}/magics/data`],
    ["$id", `${ALPINE_DOCS_ROOT}/magics/id`],
]);

export function getDirectiveByCanonicalName(name: string): DirectiveSpec | undefined {
    return canonicalIndex.get(name);
}

export function getDirectiveByAttributeName(name: string): DirectiveSpec | undefined {
    const parsed = splitAttributeName(name);
    if (!parsed) {
        return undefined;
    }
    return canonicalIndex.get(parsed.canonical) ?? aliasIndex.get(parsed.shorthand ?? "");
}

interface SplitAttributeResult {
    canonical: string;
    shorthand?: "@" | ":";
    argument?: string;
    modifiers: string[];
}

export function splitAttributeName(raw: string): SplitAttributeResult | null {
    if (!raw) {
        return null;
    }
    const shorthand = raw[0];
    if (shorthand === "@" || shorthand === ":") {
        const rest = raw.slice(1);
        if (!rest) {
            return null;
        }
        const canonical = shorthand === "@" ? "x-on" : "x-bind";
        const splitAt = rest.indexOf(".");
        if (splitAt === -1) {
            return { canonical, shorthand, argument: rest, modifiers: [] };
        }
        const argument = rest.slice(0, splitAt);
        const modifierPart = rest.slice(splitAt + 1);
        return {
            canonical,
            shorthand,
            argument: argument || undefined,
            modifiers: modifierPart ? modifierPart.split(".") : [],
        };
    }
    if (!raw.startsWith("x-")) {
        return null;
    }
    const longMatch = raw.match(/^(x-[a-z][a-z0-9-]*)(?::(.+))?$/);
    if (!longMatch) {
        return null;
    }
    const [, canonical, tail] = longMatch;
    const known = canonicalIndex.get(canonical);
    if (!known) {
        return null;
    }
    if (tail === undefined) {
        return { canonical, modifiers: [] };
    }
    const splitAt = tail.indexOf(".");
    if (splitAt === -1) {
        return { canonical, argument: tail, modifiers: [] };
    }
    const argument = tail.slice(0, splitAt);
    const modifierPart = tail.slice(splitAt + 1);
    return {
        canonical,
        argument: argument || undefined,
        modifiers: modifierPart ? modifierPart.split(".") : [],
    };
}

export function getCompletionNames(prefix: string): DirectiveSpec[] {
    const matches = new Map<string, DirectiveSpec>();
    const lowered = prefix.toLowerCase();
    const first = prefix.charAt(0);
    for (const directive of DIRECTIVES) {
        if (prefix === "" || directive.name.toLowerCase().startsWith(lowered)) {
            matches.set(directive.name, directive);
        }
        for (const alias of directive.aliases) {
            if (alias === first) {
                matches.set(alias, directive);
                continue;
            }
            if (prefix === "" || alias.startsWith(lowered)) {
                matches.set(alias, directive);
            }
        }
    }
    return [...matches.values()];
}

export function getModifiers(canonical: string): ModifierSpec[] {
    return canonicalIndex.get(canonical)?.modifiers ?? [];
}

export function getDirectiveReferenceUrl(canonical: string): string | undefined {
    return directiveReferenceIndex.get(canonical);
}

export function getMagicReferenceUrl(name: string): string | undefined {
    return magicReferenceIndex.get(name);
}

export interface HtmlCustomDataAttribute {
    name: string;
    description: string;
    values?: Array<{ name: string; description: string }>;
}

export interface HtmlCustomData {
    version: 1.1;
    tags: never[];
    attributes: HtmlCustomDataAttribute[];
}

export function toHtmlCustomData(): HtmlCustomData {
    const attributes: HtmlCustomData["attributes"] = [];
    for (const directive of DIRECTIVES) {
        const modifierDoc = directive.modifiers.length
            ? `\n\nModifiers: ${directive.modifiers.map((m) => `\`.${m.name}\` — ${m.documentation}`).join(" ")}`
            : "";
        const reference = formatReferenceMarkdown(getDirectiveReferenceUrl(directive.name));
        attributes.push({
            name: directive.name,
            description: `${directive.documentation}${modifierDoc}${reference}`,
        });
        for (const alias of directive.aliases) {
            attributes.push({
                name: alias,
                description: `${directive.documentation}\n\nShorthand for \`${directive.name}\`.${reference}`,
            });
        }
    }
    return {
        version: 1.1,
        tags: [],
        attributes,
    };
}

export function getMarkdownDocumentation(canonical: string): string | undefined {
    const documentation = canonicalIndex.get(canonical)?.documentation;
    if (!documentation) {
        return undefined;
    }
    return `${documentation}${formatReferenceMarkdown(getDirectiveReferenceUrl(canonical))}`;
}

function formatReferenceMarkdown(url: string | undefined): string {
    return url ? `\n\n[Alpine Reference](${url})` : "";
}
