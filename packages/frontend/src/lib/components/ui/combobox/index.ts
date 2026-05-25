import { Combobox as ComboboxPrimitive } from "bits-ui";

import Trigger from "./combobox-trigger.svelte";
import Content from "./combobox-content.svelte";
import Input from "./combobox-input.svelte";
import Item from "./combobox-item.svelte";
import Empty from "./combobox-empty.svelte";

const Root = ComboboxPrimitive.Root;
const Group = ComboboxPrimitive.Group;
const GroupHeading = ComboboxPrimitive.GroupHeading;
const Portal = ComboboxPrimitive.Portal;

export {
	Root,
	Trigger,
	Content,
	Input,
	Item,
	Empty,
	Group,
	GroupHeading,
	Portal,
	//
	Root as Combobox,
	Trigger as ComboboxTrigger,
	Content as ComboboxContent,
	Input as ComboboxInput,
	Item as ComboboxItem,
	Empty as ComboboxEmpty,
	Group as ComboboxGroup,
	GroupHeading as ComboboxGroupHeading,
	Portal as ComboboxPortal,
};
