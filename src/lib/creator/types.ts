import type { CreatorData, ContactEntry } from "./server";
import type { PortalData } from "./portal";

type Serialized<T> = T extends Date ? string : T extends readonly unknown[] ? { [K in keyof T]: Serialized<T[K]> } : T extends object ? { [K in keyof T]: Serialized<T[K]> } : T;
export type CreatorView = Serialized<CreatorData>;
export type CreatorProgramView = NonNullable<CreatorView["program"]>;
export type CreatorPerson = CreatorProgramView["participants"][number];
export type CreatorMissionView = CreatorProgramView["missions"][number];
export type CreatorPortalView = Serialized<PortalData>;
export type CreatorContact = ContactEntry;
