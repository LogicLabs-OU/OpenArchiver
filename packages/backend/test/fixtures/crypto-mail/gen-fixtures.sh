#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
rm -rf tmp
mkdir -p tmp

openssl req -x509 -newkey rsa:2048 -nodes \
	-keyout smime.key \
	-out smime.crt \
	-subj "/CN=OpenArchiver Crypto Mail Test/" \
	-days 1 >/dev/null 2>&1

cat >tmp/signed-content.mime <<'MIME'
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

Signed body text that must keep its MIME signature envelope.
MIME

openssl smime -sign \
	-in tmp/signed-content.mime \
	-out smime-detached-signed.eml \
	-signer smime.crt \
	-inkey smime.key \
	-from alice@example.test \
	-to bob@example.test \
	-subject "S/MIME detached signed fixture" \
	-outform SMIME

openssl smime -sign -nodetach \
	-in tmp/signed-content.mime \
	-out smime-opaque-signed.eml \
	-signer smime.crt \
	-inkey smime.key \
	-from alice@example.test \
	-to bob@example.test \
	-subject "S/MIME opaque signed fixture" \
	-outform SMIME

cat >tmp/encrypted-body.txt <<'EOF'
Encrypted body text that must not disappear from the archived EML.
EOF

openssl smime -encrypt \
	-in tmp/encrypted-body.txt \
	-out smime-enveloped.eml \
	-from alice@example.test \
	-to bob@example.test \
	-subject "S/MIME enveloped fixture" \
	-outform SMIME \
	smime.crt

cat >smime-enveloped-pkcs7.eml <smime-enveloped.eml
perl -0pi -e 's/application\/x-pkcs7-mime/application\/pkcs7-mime/gi' smime-enveloped-pkcs7.eml

cat >smime-filename-fallback-p7m.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: S/MIME filename fallback
MIME-Version: 1.0
Content-Type: application/pkcs7-mime; name="smime.p7m"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="smime.p7m"

MIIBFAKECMSPAYLOAD
EML

cat >smime-filename-fallback-p7s.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: S/MIME signature filename fallback
MIME-Version: 1.0
Content-Type: multipart/signed; boundary="fallback-p7s-boundary"

--fallback-p7s-boundary
Content-Type: text/plain; charset=utf-8

Signed content.

--fallback-p7s-boundary
Content-Type: application/octet-stream; name="smime.p7s"
Content-Disposition: attachment; filename="smime.p7s"

MIIBFAKESIGNATURE
--fallback-p7s-boundary--
EML

cat >smime-certs-only.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: S/MIME certs only
MIME-Version: 1.0
Content-Type: application/pkcs7-mime; smime-type=certs-only; name="smime.p7c"
Content-Transfer-Encoding: base64

MIIBFAKECERTS
EML

cat >multipart-encrypted-unknown-protocol.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: multipart/encrypted with unknown protocol
MIME-Version: 1.0
Content-Type: multipart/encrypted; protocol="application/vnd.example-encryption"; boundary="unknown-encrypted-boundary"

--unknown-encrypted-boundary
Content-Type: application/vnd.example-encryption

Version: 1

--unknown-encrypted-boundary
Content-Type: application/octet-stream

BASE64CIPHERTEXTPAYLOAD
--unknown-encrypted-boundary--
EML

cat >multipart-signed-unknown-protocol.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: multipart/signed with unknown protocol
MIME-Version: 1.0
Content-Type: multipart/signed; protocol="application/vnd.example-signature"; boundary="unknown-signed-boundary"

--unknown-signed-boundary
Content-Type: text/plain; charset=utf-8

Signed content with an unrecognized signature protocol.

--unknown-signed-boundary
Content-Type: application/vnd.example-signature

FAKESIGNATUREBLOB
--unknown-signed-boundary--
EML

cat >pgp-mime-encrypted.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: PGP/MIME encrypted fixture
MIME-Version: 1.0
Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="pgp-encrypted-boundary"

--pgp-encrypted-boundary
Content-Type: application/pgp-encrypted

Version: 1

--pgp-encrypted-boundary
Content-Type: application/octet-stream; name="encrypted.asc"
Content-Disposition: inline; filename="encrypted.asc"

-----BEGIN PGP MESSAGE-----

Version: OpenArchiver Test

owEBFAKEPGPMESSAGE
=test
-----END PGP MESSAGE-----
--pgp-encrypted-boundary--
EML

cat >pgp-mime-signed.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: PGP/MIME signed fixture
MIME-Version: 1.0
Content-Type: multipart/signed; protocol="application/pgp-signature"; micalg=pgp-sha256; boundary="pgp-signed-boundary"

--pgp-signed-boundary
Content-Type: text/plain; charset=utf-8

PGP signed body.

--pgp-signed-boundary
Content-Type: application/pgp-signature; name="signature.asc"
Content-Disposition: attachment; filename="signature.asc"

-----BEGIN PGP SIGNATURE-----

owEBFAKEPGPSIGNATURE
=test
-----END PGP SIGNATURE-----
--pgp-signed-boundary--
EML

cat >pgp-inline-encrypted.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: Inline PGP encrypted fixture
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

-----BEGIN PGP MESSAGE-----

Version: OpenArchiver Test

owEBFAKEINLINEPGP
=test
-----END PGP MESSAGE-----
EML

cat >pgp-inline-signed.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: Inline PGP signed fixture
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA256

Clear signed body.
-----BEGIN PGP SIGNATURE-----

owEBFAKEPGPSIGNATURE
=test
-----END PGP SIGNATURE-----
EML

cat >normal-with-attachment.eml <<'EML'
From: alice@example.test
To: bob@example.test
Subject: Normal attachment fixture
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="normal-attachment-boundary"

--normal-attachment-boundary
Content-Type: text/plain; charset=utf-8

Plain body that should survive stripping.

--normal-attachment-boundary
Content-Type: text/plain; name="ordinary.txt"
Content-Disposition: attachment; filename="ordinary.txt"
Content-Transfer-Encoding: base64

T3JkaW5hcnkgYXR0YWNobWVudCB0aGF0IHNob3VsZCBiZSBzdHJpcHBlZC4=
--normal-attachment-boundary--
EML

rm -rf tmp
