# Puente entre Clipper y la libreria tiktokautouploader (pip).
# Subcomandos:
#   install                                   instala la libreria 6.1 sin dependencias pesadas + navegador
#   login --account X --dir D                 abre la ventana de login y guarda las cookies en D
#   upload --video V --account X --desc T ...  sube o programa un video (cookies en D)
#
# Nota: tiktokautouploader 6.1 declara "inference" (torch, ~3 GB) y setuptools<81, que chocan con
# los setuptools modernos. La libreria solo usa inference-sdk (ligero) y pkg_resources, asi que se
# instala con --no-deps y se crea un shim de pkg_resources si setuptools ya no lo trae.
import argparse
import importlib.util
import os
import re
import shutil
import subprocess
import sys

SHIM = '''"""Shim de pkg_resources: setuptools moderno ya no lo incluye y tiktokautouploader lo usa."""
import importlib.metadata
import importlib.util
import os


def get_distribution(name):
    return type("Dist", (), {"version": importlib.metadata.version(name), "project_name": name})()


def resource_filename(package, resource_name):
    name = getattr(package, "__name__", str(package))
    while "." in name:
        try:
            spec = importlib.util.find_spec(name)
            if spec and spec.submodule_search_locations:
                break
        except (ModuleNotFoundError, ValueError):
            pass
        name = name.rsplit(".", 1)[0]
    spec = importlib.util.find_spec(name)
    base = list(spec.submodule_search_locations)[0] if spec.submodule_search_locations else os.path.dirname(spec.origin)
    return os.path.join(base, resource_name)
'''


def pip(*args):
    subprocess.run([sys.executable, "-m", "pip", "install", *args], check=True)

def prepare_js_assets(function):
    source = function.pkg_resources.resource_filename(function.__name__, "Js_assets")
    user_data = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".cache")
    target = os.path.join(user_data, "shorts-factory", "tiktok-uploader-js")
    os.makedirs(target, exist_ok=True)
    for name in ("login.js", "package.json"):
        shutil.copy2(os.path.join(source, name), os.path.join(target, name))
    return target


def install_js_dependencies(js_dir):
    dependencies = ("playwright-extra", "puppeteer-extra-plugin-stealth")
    if all(os.path.isdir(os.path.join(js_dir, "node_modules", name)) for name in dependencies):
        return
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise RuntimeError("No encuentro npm. Instala Node.js y reinicia Clipper.")

    try:
        # Windows necesita el shell para ejecutar el lanzador npm.cmd desde subprocess.
        subprocess.run([npm, "install", "--no-audit", "--no-fund"], cwd=js_dir, check=True, shell=os.name == "nt")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"npm no pudo instalar las dependencias de TikTok (código {e.returncode}); revisa el registro npm para ver el detalle.") from e


def cmd_install(_args):
    pip("tiktokautouploader==6.1", "--no-deps")
    pip("phantomwright", "inference-sdk", "pillow", "requests")
    if importlib.util.find_spec("pkg_resources") is None:
        import site
        for d in site.getsitepackages():
            if os.path.isdir(d):
                with open(os.path.join(d, "pkg_resources.py"), "w", encoding="utf-8") as f:
                    f.write(SHIM)
                print("Creado shim de pkg_resources en", d)
                break
    # El navegador de la subida. phantomwright_driver es un comando de consola; como modulo si existe.
    try:
        subprocess.run([sys.executable, "-m", "phantomwright_driver", "install", "chromium"], check=True)
    except (subprocess.CalledProcessError, ModuleNotFoundError):
        subprocess.run(["phantomwright_driver", "install", "chromium"], check=True)
    print("OK")


def cmd_login(args):
    os.chdir(args.dir)
    from tiktokautouploader import function as f
    print("Se abre una ventana: entra en TikTok con la cuenta", args.account)
    js_dir = prepare_js_assets(f)
    install_js_dependencies(js_dir)
    node = shutil.which("node.exe" if os.name == "nt" else "node")
    if not node:
        raise RuntimeError("No encuentro Node.js. Instálalo y reinicia Clipper.")
    subprocess.run([node, os.path.join(js_dir, "login.js"), "--proxy", "{}"], cwd=args.dir, check=True)
    os.replace("TK_cookies.json", "TK_cookies_" + args.account + ".json")
    print("Cookies guardadas para", args.account)
    print("OK")


# TikTok muestra un tour de bienvenida (react-joyride) cuya capa tapa los botones y hace fallar los clics.
def quitar_tour(page):
    try:
        page.add_style_tag(content="#react-joyride-portal,.react-joyride__overlay,.react-joyride__spotlight{display:none!important;pointer-events:none!important}")
        page.evaluate("() => document.getElementById('react-joyride-portal')?.remove()")
    except Exception:
        pass


# Cualquier clic que TikTok tape con una capa o re-dibuje sin parar: se quita el tour y se envia el clic
# directamente al boton, solo si esta a la vista. Si aun asi falla, se explica que boton y que lo tapaba.
def clic_seguro(orig, en_pagina):
    def run(self, *a, **k):
        # Sin limite propio, un clic tapado espera 30 s antes de llegar al plan B: con 5 s basta para verlo.
        k.setdefault("timeout", 5000)
        try:
            return orig(self, *a, **k)
        except Exception as e:
            msg = str(e)
            if not any(s in msg for s in ("intercepts pointer events", "was detached", "not stable")):
                raise
            page = self if en_pagina else self.page
            selector = (a[0] if a else k.get("selector")) if en_pagina else str(self)
            quitar_tour(page)
            boton = page.locator(selector).first if en_pagina else self
            try:
                if boton.is_visible():
                    boton.dispatch_event("click")
                    print("Clic enviado directamente tras un bloqueo:", selector)
                    return None
            except Exception:
                pass
            tapa = re.search(r"(<[^>]{1,160}>)[^\n]*intercepts pointer events", msg)
            print(f"TIKTOK_DETALLE: no pude pulsar {selector}" + (f"; lo tapa {tapa.group(1)}" if tapa else "; TikTok lo vuelve a dibujar sin parar"), file=sys.stderr)
            raise
    return run


def cmd_upload(args):
    os.chdir(args.dir)
    import inspect
    from tiktokautouploader import upload_tiktok, TikTokUploadError
    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    import tiktokautouploader.function as tk_function

    def sin_tour(step):
        def run(page, *a, **k):
            quitar_tour(page)
            return step(page, *a, **k)
        return run

    for name in ("_set_video_input", "_add_description_and_hashtags", "_wait_for_upload_ready", "_apply_schedule", "_submit_upload"):
        setattr(tk_function, name, sin_tour(getattr(tk_function, name)))
    # La libreria pregunta a PyPI por versiones nuevas antes de cada subida, sin limite de tiempo: solo retrasa.
    tk_function.check_for_updates = lambda: None

    # La libreria espera un boton con el texto «Post»: con TikTok Studio en español («Publicar») no llega nunca y
    # espera 20 minutos. Se espera al mismo boton por su data-e2e, que no depende del idioma, y se avisa cada 15 s.
    listo = 'button[data-e2e="post_video_button"]:not([aria-disabled="true"]):not([disabled])'

    def esperar_listo(page, *a, **k):
        import time
        quitar_tour(page)
        t0 = time.time()
        while time.time() - t0 < 20 * 60:
            # Si sale «¿Seguro que quieres cancelar la subida?», se responde «No»: nunca se cancela una subida.
            try:
                aviso = page.locator("div.common-modal-footer").filter(has=page.locator("button", has_text=re.compile(r"^(No)$"))).first
                if aviso.is_visible():
                    aviso.locator("button", has_text=re.compile(r"^(No)$")).first.click(timeout=2000)
                    print("Respondido «No» a cancelar la subida")
            except Exception:
                pass
            try:
                if page.locator(listo).first.is_visible():
                    print(f"Tik tok done loading file onto servers ({time.time() - t0:.0f} s)")
                    return
            except Exception:
                pass
            if int(time.time() - t0) % 15 == 0:
                print(f"TikTok sigue procesando el vídeo ({time.time() - t0:.0f} s)")
                if time.time() - t0 >= 60:
                    try:
                        page.screenshot(path=os.path.join(args.dir, "tiktok-espera.png"))
                    except Exception:
                        pass
            page.wait_for_timeout(1000)
        raise TikTokUploadError("TikTok tardó más de 20 minutos en procesar el vídeo; mira secrets/tiktok-espera.png")

    tk_function._wait_for_upload_ready = sin_tour(esperar_listo)

    from phantomwright.sync_api import Locator, Page
    Page.click = clic_seguro(Page.click, True)
    Locator.click = clic_seguro(Locator.click, False)

    # La libreria solo espera 2 s a que TikTok pase a «Contenido» tras pulsar Post. Mientras TikTok revisa el
    # contenido, Post sigue desactivado o sale «Post now»: se vigila hasta 5 minutos y se pulsa cuando se pueda.
    tk_submit = tk_function._submit_upload
    publicar = ('button:has-text("Post now")', 'button:has-text("Publicar ahora")', 'button[data-e2e="post_video_button"][aria-disabled="false"]')

    def submit_confirmado(page, *a, **k):
        import time
        result = tk_submit(page, *a, **k)
        if result != "Error":
            return result
        print("Esperando a que TikTok termine de revisar el vídeo (hasta 5 minutos)...")
        limite = time.time() + 300
        while time.time() < limite:
            if "/tiktokstudio/content" in page.url:
                print("Confirmado: TikTok muestra el vídeo en «Contenido».")
                try:
                    page.close()
                except Exception:
                    pass
                return None
            quitar_tour(page)
            for sel in publicar:
                try:
                    boton = page.locator(sel).first
                    if boton.is_visible():
                        boton.click(timeout=3000)
                        print("Pulsado:", sel)
                        break
                except Exception:
                    pass
            page.wait_for_timeout(3000)
        return "Error"

    tk_function._submit_upload = submit_confirmado
    extra = {}
    if "visibility" in inspect.signature(upload_tiktok).parameters:
        extra["visibility"] = args.visibility
    elif args.visibility != "everyone":
        print("TIKTOK_ERROR: la librería instalada no admite elegir la visibilidad; deja «todos» o actualiza la librería.", file=sys.stderr)
        sys.exit(2)
    try:
        r = upload_tiktok(
            video=args.video,
            description=args.desc,
            accountname=args.account,
            hashtags=tags or None,
            schedule=args.at,
            day=args.day,
            headless=True,
            suppressprint=False,
            **extra,
        )
    except TikTokUploadError as e:
        print(f"TIKTOK_ERROR: {e}", file=sys.stderr)
        sys.exit(2)
    if r != "Completed":
        print(f"TIKTOK_ERROR: resultado inesperado: {r}", file=sys.stderr)
        sys.exit(3)
    print("OK")


def cmd_check(args):
    """Comprueba la sesion sin publicar: abre la pagina de subida con las cookies y mira si TikTok pide entrar."""
    os.chdir(args.dir)
    import tiktokautouploader.function as f
    from phantomwright.sync_api import sync_playwright
    path = f"TK_cookies_{args.account}.json"
    if not os.path.exists(path):
        print("TIKTOK_ESTADO: falta")
        print("OK")
        return
    if f.check_expiry(accountname=args.account):
        print("TIKTOK_ESTADO: caducada")
        print("OK")
        return
    cookies, _ = f.read_cookies(cookies_path=path)
    with sync_playwright() as p:
        browser, context = f._make_stealth_context(p, headless=True, proxy=None)
        context.add_cookies(cookies)
        page = context.new_page()
        page.goto(f.UPLOAD_URL, timeout=45000)
        estado = "duda"
        try:
            page.wait_for_selector('input[type="file"]', state="attached", timeout=25000)
            estado = "ok"
        except Exception:
            if "login" in page.url:
                estado = "caducada"
        print("TIKTOK_ESTADO:", estado)
        browser.close()
    print("OK")


def main():
    ap = argparse.ArgumentParser(prog="tiktok")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("install")
    lg = sub.add_parser("login")
    lg.add_argument("--account", required=True)
    lg.add_argument("--dir", required=True)
    up = sub.add_parser("upload")
    up.add_argument("--video", required=True)
    up.add_argument("--account", required=True)
    up.add_argument("--desc", required=True)
    up.add_argument("--tags", default="")
    up.add_argument("--at", default=None)
    up.add_argument("--day", type=int, default=None)
    up.add_argument("--visibility", default="everyone")
    up.add_argument("--dir", required=True)
    ck = sub.add_parser("check")
    ck.add_argument("--account", required=True)
    ck.add_argument("--dir", required=True)
    args = ap.parse_args()
    if hasattr(args, "account") and not re.fullmatch(r"[A-Za-z0-9._]{1,24}", args.account.lstrip("@")):
        ap.error("account must be a TikTok username (letters, digits, dots or underscores)")
    if hasattr(args, "account"):
        args.account = args.account.lstrip("@")
    {"install": cmd_install, "login": cmd_login, "upload": cmd_upload, "check": cmd_check}[args.cmd](args)


if __name__ == "__main__":
    main()
