// Fixed helper in gallery-dl's Python environment: no user code, browser
// cookies or cookie files. Requests keeps certificate verification enabled.
export const COVER_FETCH_SCRIPT = `
import base64, sys, time
from urllib.parse import urlsplit, urljoin
import requests
url, limit, budget = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
deadline = time.monotonic() + budget
session = requests.Session()
session.auth = lambda request: request  # Do not read netrc credentials.
session.headers.update({'Referer':'https://www.behance.net/', 'Accept':'image/*'})
for hop in range(4):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None,443) or not parsed.hostname or not parsed.hostname.endswith('.behance.net'):
        raise ValueError('Invalid Behance cover URL')
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Cover timeout')
    session.cookies.clear()
    with session.get(url, stream=True, allow_redirects=False, timeout=remaining) as response:
        if response.status_code in (301,302,303,307,308):
            if hop == 3 or not response.headers.get('Location'):
                raise ValueError('Cover redirect limit exceeded')
            url = urljoin(url, response.headers['Location'])
            continue
        response.raise_for_status()
        if int(response.headers.get('Content-Length','0')) > limit:
            raise ValueError('Cover too large')
        parts, size = [], 0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > limit or time.monotonic() > deadline:
                raise ValueError('Cover size/time limit exceeded')
            parts.append(chunk)
        print(base64.b64encode(b''.join(parts)).decode('ascii'))
        break
`;
