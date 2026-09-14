import type{ReactNode}from'react'
export function Score({n}:{n?:number}){return n===undefined?<i className="status wait">评估中</i>:<strong className={`score ${n>=85?'good':n>=60?'mid':'low'}`}>{n}<small>分</small></strong>}
export function Empty({text}:{text:string}){return <div className="empty"><b>◎</b><p>{text}</p></div>}
export function Title({title,note,children}:{title:string;note:string;children?:ReactNode}){return <div className="title"><span><h2>{title}</h2><p>{note}</p></span>{children}</div>}
export function Head({name,action}:{name:string;action?:()=>void}){return <h3 className="head">{name}{action&&<button onClick={action}>查看全部 ›</button>}</h3>}
