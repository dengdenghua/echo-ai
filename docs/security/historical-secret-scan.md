# Historical secret scan exceptions

Default Gitleaks rules remain enabled. .gitleaksignore lists only exact
commit, file, rule and line fingerprints. No directory, file, provider,
rule or complete commit is excluded. A later edit remains eligible for scanning.

## Reviewed findings

The pre-exception scan uses Gitleaks 8.24.3 over all local Git refs with
--log-opts="--all --no-textconv". Reading committed content directly avoids a
missing Windows DOCX converter; it changes no secret detector. The scan
reports 46 findings in 320 commits. The prior reviewed locally generated
JWT signer expression already has one exact exception.

| Source | Count | Meaning and evidence |
| --- | ---: | --- |
| Vendor export responses | 5 | 77ircloud data.key identifies an export job beside its name, progress and status. |
| Vendor Coze examples | 2 | The API key is the literal numbered placeholder sk-1234567890. |
| Vendor DingTalk examples | 3 | dentryKey locates a document inside an authenticated document-read URL. |
| Vendor Feishu examples | 4 | Document/base identifiers and an IM pagination cursor, rather than a login credential. |
| Vendor Linkfox example | 1 | The sample has 29 characters, ellipses and seven dot segments; it cannot be an issued JWT. |
| Vendor Tencent Ads enums | 9 | Three copies of PARENTING_6_12, PARENTING_12_24 and PARENTING_24_36, audience category names beside numeric values. |
| Initial channel/API examples | 7 | Discord/Home Assistant examples end in ellipses; Slack uses ordered digits/letters; curl snippets contain your-api-key or YOUR_API_KEY. |
| Initial source syntax | 3 | echo.market.mine.v1 is a localStorage key; the other matches are token-cost prose and an Ed25519PrivateKey type annotation. |
| Initial detector/test fixtures | 12 | Fixed synthetic redaction, configuration and session inputs. The replay HS256 JWT has only 20 signature bytes instead of 32; the env fixture has a literal signature segment; the PEM fixture cannot be parsed as a private key. Remaining values use ordered test sequences or test markers. |

Vendor findings bind the imported documentation commit
6e6bf99c878b36f343ddfd7a9ba59dfa52a76c67. Initial-source findings bind
fb9a584c3bd6b1889ddd65c49fc9fe4c730d0484. Do not copy these exceptions to
new commits or generalize them into secret-value regex allowlists.

## Verification boundary

A later scan of the current checkout includes the local remote-tracking
wip/d-drive-native-ui-20261008 branch, which was absent from the earlier
isolated ref inventory. Its cb6191270d3b141d2c57908582a589cc39817539 commit adds
one exact fingerprint at tests/test_channel_webhook_auth.py:205. The matched
call passes a synthetic service-account fixture, the ordered mock project
number 1234567890, and a certificate provider generated inside the test. The
test creates a fresh RSA signer and self-signed certificate at runtime; it
does not contain an issued Google credential. This exception remains bound
to that original commit, path, rule and line. The same path and line in a
fresh commit must still be detected.

The full historical scan must finish without scanner errors and report zero
remaining findings using these exact fingerprints. A fresh commit at the
same path and line as a reviewed fixture must still be rejected by the
default detector. The check uses an unissued SHA-derived string and no real
credential. An empty targeted source scan alone does not prove that history
is clear. Remote CI must also confirm the published commit.
