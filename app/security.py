import os
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

load_dotenv()

KEY_FILE = ".secret.key"

def _load_key():
    env = os.getenv("APP_FERNET_KEY") or os.getenv("FERNET_KEY")
    if env:
        return env.encode()
    if os.path.exists(KEY_FILE):
        return open(KEY_FILE,"rb").read().strip()
    key = Fernet.generate_key()
    with open(KEY_FILE,"wb") as f: f.write(key)
    return key

FERNET = Fernet(_load_key())

def encrypt_secret(value: str|None):
    if not value: return None
    return FERNET.encrypt(value.encode()).decode()

def decrypt_secret(value: str|None):
    if not value: return None
    try: return FERNET.decrypt(value.encode()).decode()
    except InvalidToken: return None
