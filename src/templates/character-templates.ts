import type { CharacterTemplateData } from "../shared/types";
import { parseCharacterFile } from "../shared/character-format";

export type CharacterTemplate = CharacterTemplateData;

const files = import.meta.glob("./built-in-characters/*.json", { eager: true, import: "default" });

export const characterTemplates: CharacterTemplate[] = Object.values(files)
  .map((value) => parseCharacterFile(value, true).template)
  .sort((left, right) => left.displayName.localeCompare(right.displayName));
