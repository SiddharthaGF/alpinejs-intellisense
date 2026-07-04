import type {
    AlpineDirectiveNode,
    DirectiveValueKind,
    OffsetRange,
} from "../index.js";
import { extractAlpineDirectives, parseElements } from "../index.js";
import type { DirectiveSpec } from "@alpine-language-tools/alpine-spec";

/**
 * Plugin contract: third-party packages (or user-side code) push directive
 * metadata into the server; the server then exposes completions, hover and
 * the augmented directive extractor to itself.
 *
 * Custom directives live in their own identifier space (`x-foo`) and never
 * collide with the built-in catalogue shipped by `alpine-spec`.
 */
export interface CustomDirective {
    name: string;
    aliases?: string[];
    arguments?: string[];
    modifiers?: string[];
    valueKind?: DirectiveValueKind;
    documentation?: string;
}

function toDirectiveSpec(custom: CustomDirective): DirectiveSpec {
    return {
        name: custom.name,
        aliases: custom.aliases ?? [],
        arguments: custom.arguments ?? [],
        modifiers: (custom.modifiers ?? []).map((name) => ({
            name,
            documentation: "",
        })),
        valueKind: custom.valueKind ?? "none",
        documentation: custom.documentation ?? "",
    };
}

interface ParsedElementShape {
    tag: string | undefined;
    attributes: Array<{
        name: string;
        value: string | undefined;
        nameRange: OffsetRange;
        valueRange: OffsetRange | undefined;
        attributeRange: OffsetRange;
    }>;
    children: ParsedElementShape[];
    start: number;
    end: number;
}

export class PluginRegistry {
    private readonly specs: Map<string, CustomDirective> = new Map();
    private readonly directiveSpecs: Map<string, DirectiveSpec> = new Map();

    register(spec: CustomDirective): void {
        this.specs.set(spec.name, spec);
        this.directiveSpecs.set(spec.name, toDirectiveSpec(spec));
    }

    unregister(name: string): boolean {
        const removed = this.specs.delete(name);
        this.directiveSpecs.delete(name);
        return removed;
    }

    list(): CustomDirective[] {
        return [...this.specs.values()];
    }

    public listSpecs(): DirectiveSpec[] {
        return [...this.directiveSpecs.values()];
    }

    knownCanonical(name: string): boolean {
        return this.specs.has(name);
    }

    specsForCanonical(name: string): CustomDirective | undefined {
        return this.specs.get(name);
    }

    augment(text: string): AlpineDirectiveNode[] {
        if (this.directiveSpecs.size === 0) {
            return extractAlpineDirectives(text);
        }
        const roots = parseElements(text) as unknown as ParsedElementShape[];
        const out: AlpineDirectiveNode[] = [];
        const knownByName = new Map<string, DirectiveSpec>();
        for (const spec of this.directiveSpecs.values()) {
            knownByName.set(spec.name, spec);
        }
        walk(roots, knownByName, out);
        return out;
    }
}

function walk(
    elements: ParsedElementShape[],
    knownByName: Map<string, DirectiveSpec>,
    out: AlpineDirectiveNode[],
): void {
    const stack = [...elements];
    while (stack.length > 0) {
        const element = stack.shift();
        if (!element) {
            continue;
        }
        for (const attribute of element.attributes) {
            const node = toDirectiveNode(attribute, element, knownByName);
            if (node) {
                out.push(node);
            }
        }
        if (element.children.length > 0) {
            stack.unshift(...element.children);
        }
    }
}

function toDirectiveNode(
    attribute: ParsedElementShape["attributes"][number],
    element: ParsedElementShape,
    knownByName: Map<string, DirectiveSpec>,
): AlpineDirectiveNode | null {
    const split = splitAttributeNameLocal(attribute.name);
    if (!split) {
        return null;
    }
    const spec = knownByName.get(split.canonical);
    if (!spec) {
        return null;
    }
    return {
        originalName: attribute.name,
        canonicalName: spec.name,
        shorthand: split.shorthand,
        argument: split.argument,
        modifiers: [...split.modifiers],
        value: attribute.value,
        valueKind: spec.valueKind,
        attributeRange: attribute.attributeRange,
        nameRange: attribute.nameRange,
        valueRange: attribute.valueRange ?? undefined,
        elementRange: { start: element.start, end: Math.max(element.end, element.start) },
    };
}

interface LocalSplit {
    canonical: string;
    shorthand?: "@" | ":";
    argument?: string;
    modifiers: string[];
}

function splitAttributeNameLocal(raw: string): LocalSplit | null {
    if (!raw) {
        return null;
    }
    const first = raw.charAt(0);
    if (first === "@") {
        const rest = raw.slice(1);
        if (!rest) {
            return null;
        }
        const splitAt = rest.indexOf(".");
        if (splitAt === -1) {
            return { canonical: "x-on", shorthand: "@", argument: rest, modifiers: [] };
        }
        return {
            canonical: "x-on",
            shorthand: "@",
            argument: rest.slice(0, splitAt) || undefined,
            modifiers: rest.slice(splitAt + 1) ? rest.slice(splitAt + 1).split(".") : [],
        };
    }
    if (first === ":") {
        const rest = raw.slice(1);
        if (!rest) {
            return null;
        }
        const splitAt = rest.indexOf(".");
        if (splitAt === -1) {
            return { canonical: "x-bind", shorthand: ":", argument: rest, modifiers: [] };
        }
        return {
            canonical: "x-bind",
            shorthand: ":",
            argument: rest.slice(0, splitAt) || undefined,
            modifiers: rest.slice(splitAt + 1) ? rest.slice(splitAt + 1).split(".") : [],
        };
    }
    if (!raw.startsWith("x-")) {
        return null;
    }
    const longMatch = raw.match(/^(x-[a-z][a-z0-9-]*)(?::(.+))?$/);
    if (!longMatch) {
        return null;
    }
    const canonical = longMatch[1] ?? "";
    const tail = longMatch[2];
    if (tail === undefined) {
        return { canonical, modifiers: [] };
    }
    const splitAt = tail.indexOf(".");
    if (splitAt === -1) {
        return { canonical, argument: tail, modifiers: [] };
    }
    return {
        canonical,
        argument: tail.slice(0, splitAt) || undefined,
        modifiers: tail.slice(splitAt + 1) ? tail.slice(splitAt + 1).split(".") : [],
    };
}
