import { Popover as PopoverPrimitive } from "bits-ui";

import Content from "./popover-content.svelte";
import Trigger from "./popover-trigger.svelte";
import Close from "./popover-close.svelte";

const Root = PopoverPrimitive.Root;

export {
	Root,
	Content,
	Trigger,
	Close,
	//
	Root as Popover,
	Content as PopoverContent,
	Trigger as PopoverTrigger,
	Close as PopoverClose,
};
