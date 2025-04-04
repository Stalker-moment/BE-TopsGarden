/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
// Written by Forge Partner Development
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

import pkg from 'forge-apis';
const { AuthClientTwoLegged } = pkg;
//import config from './config.js';

/**
 * Initializes a Forge client for 2-legged authentication.
 * @param {string[]} scopes List of resource access scopes.
 * @returns {AuthClientTwoLegged} 2-legged authentication client.
 */
export function getClient(scopes) {
    const client_id = "CUX4MS07WHLJvB82AtVEZn2CmiTUqkvGat7jGG9gsvH0CUFl";
    const client_secret = "BkAk59ww8OK0gFopVAHFvUMZYSRIH8cdxldsE4XrbMu0A33zmWWpt5YsRJVgPKyJ";
    return new AuthClientTwoLegged(client_id, client_secret, ['bucket:create', 'bucket:read', 'data:read', 'data:create', 'data:write']);
}

let cache = new Map();
async function getToken(scopes) {
    const key = scopes.join('+');
    if (cache.has(key) && cache.get(key).expires_at > Date.now()) {
        return cache.get(key);
    }
    const client = getClient(scopes);
    let credentials = await client.authenticate();
    credentials.expires_at = Date.now() + credentials.expires_in * 1000;
    cache.set(key, credentials);
    return credentials;
}

/**
 * Retrieves a 2-legged authentication token for preconfigured public scopes.
 * @returns Token object: { "access_token": "...", "expires_at": "...", "expires_in": "...", "token_type": "..." }.
 */
export async function getPublicToken() {
    return getToken(['viewables:read']);
}

/**
 * Retrieves a 2-legged authentication token for preconfigured internal scopes.
 * @returns Token object: { "access_token": "...", "expires_at": "...", "expires_in": "...", "token_type": "..." }.
 */
export async function getInternalToken() {
    return getToken(['bucket:create', 'bucket:read', 'data:read', 'data:create', 'data:write']);
}
