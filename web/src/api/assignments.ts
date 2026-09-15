import{apiRequest}from'./client';import type{Assignment,Rubric}from'../types'
export type CreateAssignmentInput=Pick<Assignment,'title'|'language'|'description'|'status'|'maxSubmissions'|'dueAt'|'llmEvaluationEnabled'>&{rubric:Rubric[]}
export const listAssignments=(token:string)=>apiRequest<Assignment[]>('/assignments',token)
export const createAssignment=(token:string,input:CreateAssignmentInput)=>apiRequest<Assignment>('/assignments',token,{method:'POST',body:JSON.stringify(input)})
export const updateAssignmentStatus=(token:string,id:string,status:Assignment['status'])=>apiRequest<{id:string;status:Assignment['status']}>(`/assignments/${id}/status`,token,{method:'PATCH',body:JSON.stringify({status})})
export const updateAssignmentMaxSubmissions=(token:string,id:string,maxSubmissions:number)=>apiRequest<{id:string;maxSubmissions:number}>(`/assignments/${id}/max-submissions`,token,{method:'PATCH',body:JSON.stringify({maxSubmissions})})
