export type Action = string;

export type Resource = string;

export interface PolicyStatement {
	Effect: 'Allow' | 'Deny';
	Action: Action[];
	Resource: Resource[];
	Condition?: {
		[key: string]: string | number | boolean;
	};
}
