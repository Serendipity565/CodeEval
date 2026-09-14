import{apiRequest}from'./client';import type{Submission}from'../types'
export const listSubmissions=(token:string)=>apiRequest<Submission[]>('/submissions',token)
export const createSubmission=(token:string,assignmentId:string,code:string)=>apiRequest<Submission>('/submissions',token,{method:'POST',body:JSON.stringify({assignmentId,code})})
