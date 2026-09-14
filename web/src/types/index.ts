export type Rubric={key:string;name:string;description:string;weight:number}
export type Assignment={id:string;teacherId:string;teacherName:string;title:string;language:string;description:string;status:'open'|'closed';maxSubmissions:number;dueAt:string;rubric:Rubric[];llmEvaluationEnabled:boolean}
export type Evaluation={total:number;maxTotal:number;summary:string;provider:string;dimensions:{key:string;name:string;score:number;maxScore:number;evidence:string;suggestion:string}[]}
export type Submission={id:string;assignmentId:string;studentName:string;submittedAt:string;status:string;code:string;evaluation?:Evaluation}
export type User={id:number;username:string;displayName:string;role:'teacher'|'student'}
export type AuthState={token:string;user:User}
export type View='home'|'assignments'|'submissions'|'publish'
