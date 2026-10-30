package config

// DefaultUpdateManifestPublicKey is the public Ed25519 key that signs LSR
// signage Player releases in github.com/arspavel/tilecast. It is public trust
// material, not a secret. Deployments may override it with
// TILECAST_UPDATE_MANIFEST_PUBLIC_KEY for custom Player builds.
const DefaultUpdateManifestPublicKey = "j+lAHfDoSi9i+RekdPbqe3YLOUeN+uHzl0strKPE65I="
