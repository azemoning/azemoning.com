---
title: "How Your Developers Log Into OpenShift (And Why kubeadmin Isn't Enough)"
slug: "openshift-oauth-authentication"
date: 2024-12-05
category: "OpenShift"
tags: ["openshift", "oauth", "authentication", "ldap", "security"]
readingTime: "9 min read"
excerpt: "How do your developers log into the OpenShift console? If the answer is kubeadmin, we need to talk."
---

How do your developers log into the OpenShift console?

If the answer is `kubeadmin`, we need to talk.

`kubeadmin` is the bootstrap admin account. It's created during cluster installation. It has `cluster-admin` privileges. It's meant for initial setup, not for daily use. Using it as your primary authentication method is a security problem waiting to happen.

<!-- truncate -->

## What kubeadmin is (and isn't)

`kubeadmin` is a temporary, bootstrap-only credential. It exists so you can set up the cluster after installation: configure storage, networking, monitoring, and importantly, set up a proper identity provider.

There's no user behind `kubeadmin`. It's not tied to LDAP, it doesn't have MFA, and you can't audit who used it (because everyone uses the same password). If your team shares the `kubeadmin` password, you have no way to know who did what on the cluster.

The kubeadmin password is printed during cluster installation (or stored in the install directory). If someone has access to that, they have `cluster-admin`. Rotate it. Better yet, disable it after setting up a real identity provider.

## OpenShift's OAuth server

OpenShift has a built-in OAuth server. It runs in the `openshift-authentication` namespace and handles all authentication flows:

```bash
# Check the OAuth configuration
oc get oauth cluster -o yaml
```

```yaml
apiVersion: config.openshift.io/v1
kind: OAuth
metadata:
  name: cluster
spec:
  identityProviders:
  - name: htpasswd
    mappingMethod: claim
    type: HTPasswd
    htpasswd:
      fileData:
        name: htpass-secret
```

The `identityProviders` field is where you configure how users authenticate. OpenShift supports several identity provider types.

## HTPasswd: the quick start

HTPasswd is the simplest identity provider. You create a file with username:password pairs, store it as a Secret, and point the OAuth config at it.

```bash
# Create the htpasswd file
htpasswd -c -B -b htpasswd alice alice123
htpasswd -B -b htpasswd bob bob456

# Create the secret
oc create secret generic htpass-secret \
  --from-file=htpasswd=htpasswd \
  -n openshift-config

# Configure OAuth
oc patch oauth cluster --type merge -p '{
  "spec": {
    "identityProviders": [{
      "name": "htpasswd",
      "mappingMethod": "claim",
      "type": "HTPasswd",
      "htpasswd": {
        "fileData": {
          "name": "htpass-secret"
        }
      }
    }]
  }
}'
```

After a few seconds, users can log in with their htpasswd credentials.

HTPasswd is fine for testing and small teams. It's not great for production because:
- Passwords are stored in a Secret (base64-encoded, not encrypted)
- No password policy enforcement
- No integration with corporate identity systems
- Adding/removing users requires updating the Secret

## LDAP: the enterprise standard

In most enterprise environments, LDAP is the standard. Most enterprises do. OpenShift's LDAP identity provider connects to your existing Active Directory or OpenLDAP server:

```yaml
apiVersion: config.openshift.io/v1
kind: OAuth
metadata:
  name: cluster
spec:
  identityProviders:
  - name: corporate-ldap
    mappingMethod: claim
    type: LDAP
    ldap:
      attributes:
        id:
        - dn
        email:
        - mail
        name:
        - cn
        preferredUsername:
        - uid
      bindDN: "cn=openshift-bind,ou=service-accounts,dc=company,dc=com"
      bindPassword:
        name: ldap-bind-password
      ca:
        name: ldap-ca-cert
      insecure: false
      url: "ldaps://ldap.company.com:636/ou=users,dc=company,dc=com?uid?sub?(objectClass=person)"
```

The `bindDN` and `bindPassword` are the service account credentials for searching LDAP. The `url` specifies the search base, attribute filter, and scope.

Create the secrets for the bind password and CA cert:

```bash
oc create secret generic ldap-bind-password \
  --from-literal=bindPassword='service-account-password' \
  -n openshift-config

oc create secret generic ldap-ca-cert \
  --from-file=ca.crt=company-ca.pem \
  -n openshift-config
```

After configuration, users log in with their LDAP credentials. OpenShift creates an Identity and User object for each user who logs in:

```bash
# List identities
oc get identity

# List users
oc get users
```

## OpenID Connect (OIDC)

If your company uses an OIDC provider (Keycloak, Azure AD, Okta, Auth0), you can configure it:

```yaml
apiVersion: config.openshift.io/v1
kind: OAuth
metadata:
  name: cluster
spec:
  identityProviders:
  - name: keycloak
    mappingMethod: claim
    type: OpenID
    openID:
      clientID: openshift
      clientSecret:
        name: keycloak-client-secret
      extraScopes:
      - email
      - profile
      claims:
        preferredUsername:
        - preferred_username
        name:
        - name
        email:
        - email
      issuer: "https://keycloak.company.com/realms/production"
```

OIDC delegates authentication to the external provider. Users get redirected to the provider's login page, authenticate there, and are sent back to OpenShift with a token.

This is the most modern approach. It supports MFA, conditional access policies, and all the features your identity provider offers.

## Mapping method: claim vs lookup vs add

When a user authenticates through an identity provider, OpenShift creates an Identity object and maps it to a User. The `mappingMethod` controls how this works:

**claim** (default): OpenShift automatically creates users based on the identity provider's claims. The username comes from `preferredUsername` (LDAP) or the `sub` claim (OIDC).

**lookup**: You manually create the mapping between identity and user. Useful when you want to control usernames:

```bash
# Create a user manually
oc create user alice

# Create the identity mapping
oc create identity corporate-ldap:uid=alice,ou=users,dc=company,dc=com
oc create useridentitymapping corporate-ldap:uid=alice,ou=users,dc=company,dc=com alice
```

**add**: Similar to claim but adds the identity to an existing user without replacing existing identities. A user can have multiple identities.

## OAuth tokens and service accounts

When a user logs in through the web console, they get an OAuth access token. This token is used for subsequent API calls:

```bash
# Check your current token
oc whoami -t

# List OAuth access tokens
oc get oauthaccesstokens

# Delete a token (logout)
oc delete oauthaccesstoken sha256~xxxxx
```

Tokens have a default lifetime. Configure it:

```yaml
apiVersion: config.openshift.io/v1
kind: OAuth
metadata:
  name: cluster
spec:
  tokenConfig:
    accessTokenMaxAgeSeconds: 86400  # 24 hours
    accessTokenInactivityTimeout: 10m  # Auto-logout after 10 min of inactivity
```

**Service accounts** use a different token mechanism. They're not managed by the OAuth server:

```bash
# Create a long-lived token for a service account (legacy, not recommended)
oc create token my-sa -n my-project --duration=8760h  # 1 year

# Recommended: use short-lived tokens
oc create token my-sa -n my-project --duration=1h
```

## RBAC: what happens after authentication

Authentication (who are you?) is separate from authorization (what can you do?). After OAuth verifies identity, OpenShift's RBAC system determines permissions.

Assign roles to users and groups:

```bash
# Give a user admin access to a project
oc adm policy add-role-to-user admin alice -n my-project

# Give a group view access cluster-wide
oc adm policy add-cluster-role-to-group view developers

# Create a group from LDAP
oc adm groups new developers
oc adm groups add-users developers alice bob
```

LDAP group sync is possible with the `oc adm groups sync` command, which pulls groups from LDAP and creates corresponding OpenShift groups.

## Practical advice

**Disable kubeadmin after setup.** Or at minimum, rotate the password and store it in a password manager. Don't share it.

**Use groups, not individual users.** Assign roles to groups. When someone joins or leaves the team, you add/remove them from the group. Don't maintain per-user role bindings.

**Set token inactivity timeout.** For regulated environments, this is often a compliance requirement. Users should be auto-logged-out after inactivity.

**Use OIDC if possible.** It's the most secure option. MFA, conditional access, audit logging... all handled by your identity provider.

**Test identity provider changes on staging first.** Changing the OAuth config affects all users. A misconfiguration can lock everyone out (except kubeadmin). Always test before applying to production.

Getting authentication right is foundational. Everything else in the cluster (RBAC, NetworkPolicies, SCCs) depends on knowing who the user is. Invest the time to set it up properly. Your security team will thank you.