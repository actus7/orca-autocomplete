import{Rl as i}from"./chunk-F6PKYRF7.js";var d=Object.defineProperty,_=Object.getOwnPropertyDescriptor,u=Object.getOwnPropertyNames,y=Object.prototype.hasOwnProperty,g=(a,e,r,o)=>{if(e&&typeof e=="object"||typeof e=="function")for(let t of u(e))!y.call(a,t)&&t!==r&&d(a,t,{get:()=>e[t],enumerable:!(o=_(e,t))||o.enumerable});return a},p=(a,e,r)=>(g(a,e,"default"),r&&g(r,e,"default")),n={};p(n,i);var l={},s={},L=class c{static getOrCreate(e){return s[e]||(s[e]=new c(e)),s[e]}constructor(e){this._languageId=e,this._loadingTriggered=!1,this._lazyLoadPromise=new Promise((r,o)=>{this._lazyLoadPromiseResolve=r,this._lazyLoadPromiseReject=o})}load(){return this._loadingTriggered||(this._loadingTriggered=!0,l[this._languageId].loader().then(e=>this._lazyLoadPromiseResolve(e),e=>this._lazyLoadPromiseReject(e))),this._lazyLoadPromise}};function P(a){let e=a.id;l[e]=a,n.languages.register(a);let r=L.getOrCreate(e);n.languages.registerTokensProviderFactory(e,{create:async()=>(await r.load()).language}),n.languages.onLanguageEncountered(e,async()=>{let o=await r.load();n.languages.setLanguageConfiguration(e,o.conf)})}export{P as a};
/*! Bundled license information:

monaco-editor/esm/vs/basic-languages/_.contribution.js:
  (*!-----------------------------------------------------------------------------
   * Copyright (c) Microsoft Corporation. All rights reserved.
   * Version: 0.52.2(404545bded1df6ffa41ea0af4e8ddb219018c6c1)
   * Released under the MIT license
   * https://github.com/microsoft/monaco-editor/blob/main/LICENSE.txt
   *-----------------------------------------------------------------------------*)
*/
