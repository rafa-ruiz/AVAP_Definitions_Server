-- Original Commands
CREATE TABLE IF NOT EXISTS obex_dapl_functions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    interface TEXT,
    description TEXT,
    type VARCHAR(50),
    logic BOOLEAN,
    componenttype VARCHAR(50),
    service VARCHAR(50),
    command VARCHAR(50),
    code TEXT
);

-- Bytecode
CREATE TABLE IF NOT EXISTS avap_bytecode (
    id SERIAL PRIMARY KEY,
    command_name VARCHAR(100) UNIQUE NOT NULL,
    bytecode BYTEA,
    version INTEGER DEFAULT 1,
    compiled_at TIMESTAMP DEFAULT NOW(),
    source_hash VARCHAR(64),
    is_verified BOOLEAN DEFAULT FALSE
);

-- Inserting commands
INSERT INTO obex_dapl_functions (name, interface, code) VALUES
(
    'addVar', 
    '[{"item":"targetVarName","type":"variable"},{"item":"varValue","type":"value"}]',
    $body$
target = task["properties"]["targetVarName"]
raw_value = task["properties"]["varValue"]

# Resolución Inteligente
# 1. ¿Es una variable existente?
if raw_value in self.conector.variables:
    resolved_value = self.conector.variables[raw_value]
# 2. ¿Es un número (string que representa un entero)?
elif isinstance(raw_value, str) and raw_value.isdigit():
    resolved_value = int(raw_value)
# 3. ¿Es ya un número (int/float)?
elif isinstance(raw_value, (int, float)):
    resolved_value = raw_value
# 4. En cualquier otro caso, es un literal
else:
    resolved_value = raw_value

#print(f"Setting {target} = {resolved_value}")
self.conector.variables[target] = resolved_value
$body$
),

('addResult', '[{"item":"sourceVariable","type":"variable"}]',
$body$
source = task["properties"]["sourceVariable"]
# Si la variable no existe en el conector, devolvemos None (null en JSON)
value = self.conector.variables.get(source, None)
self.conector.results[source] = value
$body$),

('addParam', '[{"item":"param","type":"value"},{"item":"variable","type":"var"}]',
 'param_name = task["properties"].get("param") or next(iter(task["properties"].values()), None)
variable_name = task["properties"].get("variable") or next(reversed(task["properties"].values()), None)

value = None

if hasattr(self.conector, "req"):
    req = self.conector.req
    try:
        # Tornado way: obtener query param
        value = req.get_query_argument(param_name)
    except tornado.web.MissingArgumentError:
        try:
            # Probar en body JSON
            body_data = json.loads(req.request.body.decode())
            value = body_data.get(param_name)
        except:
            # Probar en body_arguments si existe
            try:
                value = req.body_arguments.get(param_name, [None])[0]
            except:
                pass

if variable_name:
    self.conector.variables[variable_name] = value

self.conector.logger.info(f"[AVAP PARSER] ADDING VARIABLE {variable_name} FROM PARAMETER {param_name} VALUE {value}")'),

('if', '[{"item":"variable","type":"variable"},{"item":"variableValue","type":"variable"},{"item":"comparator","type":"value"}]',
$body$
def try_num(v):
    s = str(v).strip().strip('"').strip("'")
    try:
        return float(s) if "." in s else int(s)
    except:
        return s

v1 = try_num(self.conector.variables.get(task["properties"]["variable"], task["properties"]["variable"]))
v2 = try_num(task["properties"]["variableValue"])
op = str(task["properties"]["comparator"]).strip().strip('"').strip("'")

res = False
if op in ["=", "=="]: res = (str(v1) == str(v2))
elif op == ">": res = (v1 > v2)
elif op == "<": res = (v1 < v2)
elif op == ">=": res = (v1 >= v2)
elif op == "<=": res = (v1 <= v2)
elif op == "!=": res = (str(v1) != str(v2))

branch = "true" if res else "false"
if branch in task["branches"]:
    for step in task["branches"][branch]:
        self.process_step(step)

# IMPORTANTE: Sincronizar de vuelta al finalizar la rama
# Esto asegura que 'final' y otras variables lleguen al Executor principal
self.conector.variables.update(self.conector.variables)
$body$),

('end', '[]', 
'# El comando end() marca el fin de un bloque condicional (if/else) o loop.
# La logica de agrupacion se resuelve en el Parser del servidor.
import os
if os.getenv("DEBUG") == "True":
    print("[AVAP] Finalizando bloque de control (end)")
'),
('else', '[]', 
'# El comando else() en AVAP actua como separador de flujo.
# La logica de ejecucion reside en el comando if() padre, 
# el cual accede a task["branches"]["false"].
import os
if os.getenv("DEBUG") == "True":
    print("[AVAP] Entrando en bloque ELSE (marcador)")
'),

('startLoop', '[{"item":"varName","type":"variable"},{"item":"from","type":"value"},{"item":"to","type":"value"}]',
$body$
sequence = task.get("sequence", [])
varName = task["properties"].get("varName")
LoopFrom = task["properties"].get("from")
Loopto = task["properties"].get("to")

def resolve_robust(v):
    # Buscar en variables o usar el literal
    val = self.conector.variables.get(v, v)
    # Limpiar y convertir
    s = str(val).strip().strip('"').strip("'")
    try:
        return int(float(s)) # Maneja "4", "4.0" y " 4 "
    except:
        return 0

start_val = resolve_robust(LoopFrom)
end_val = resolve_robust(Loopto)

self.conector.variables[varName] = start_val

# Ejecución del bucle
while self.conector.variables[varName] <= end_val:
    for stp in sequence:
        if not self.process_step(stp):
            break
    self.conector.variables[varName] += 1

# Sincronizar contexto al salir
self.conector.variables.update(self.conector.variables)
$body$),

('endLoop', '[]',
$body$
# Marcador de fin de bucle. 
# La lógica recursiva es manejada por el nodo startLoop.
import os
if os.getenv("DEBUG") == "True":
    print("[AVAP] endLoop marker reached")
$body$),

(
    'RequestGet', 
    '[{"item":"url","type":"variable"},{"item":"querystring","type":"variable"},{"item":"headers","type":"variable"},{"item":"o_result","type":"variable"}]',
    $body$
import requests
import json

def resolve(val):
    if isinstance(val, str) and val in self.conector.variables:
        return self.conector.variables[val]
    return val

def ensure_dict(val):
    if isinstance(val, dict): return val
    if not val: return {}
    if isinstance(val, str):
        try: return json.loads(val.replace("'", '"'))
        except: pass
    return {}

# 1. Obtener inputs
raw_url = resolve(task["properties"].get("url"))
raw_qs  = resolve(task["properties"].get("querystring"))
raw_head = resolve(task["properties"].get("headers"))
# Soporte para asignación: res = RequestGet(...)
target_var = task.get("context") or task["properties"].get("o_result")

url = str(raw_url).strip()
params = ensure_dict(raw_qs)
headers = ensure_dict(raw_head)

# 2. Ejecución (Sin el try/except interno que se come el error)
response = requests.get(url, params=params, headers=headers, timeout=30)

# CLAVE: Si el código es 4xx o 5xx, lanza una excepción que captura el Executor
response.raise_for_status() 

try:
    result_data = response.json()
except:
    result_data = response.text

# 3. Guardar resultado
if target_var:
    self.conector.variables[target_var] = result_data
$body$
),

(
    'RequestPost', 
    '[
        {"item":"url","type":"variable"},
        {"item":"querystring","type":"variable"},
        {"item":"headers","type":"variable"},
        {"item":"body","type":"variable"},
        {"item":"o_result","type":"variable"}
    ]',
    $body$
import requests
import json

# --- 1. HELPERS (Consistentes con RequestGet) ---
def resolve(val):
    if isinstance(val, str) and val in self.conector.variables:
        return self.conector.variables[val]
    return val

def ensure_dict(val):
    if isinstance(val, dict): return val
    if not val: return {}
    if isinstance(val, str):
        try:
            return json.loads(val.replace("'", '"'))
        except:
            pass
    return {}

# --- 2. INPUTS ---
raw_url = resolve(task["properties"].get("url"))
raw_qs  = resolve(task["properties"].get("querystring"))
raw_head = resolve(task["properties"].get("headers"))
raw_body = resolve(task["properties"].get("body"))

# Lógica de destino (Asignación vs Parámetro)
target_var = task.get("context")
if not target_var:
    target_var = task["properties"].get("o_result")

url = str(raw_url).strip()
params = ensure_dict(raw_qs)
headers = ensure_dict(raw_head)

# --- 3. PROCESAMIENTO INTELIGENTE DEL BODY ---
# Intentamos detectar si el body es JSON o un Diccionario
body_data = raw_body
is_json = False

if isinstance(raw_body, dict):
    is_json = True
elif isinstance(raw_body, str):
    try:
        # Intentamos parsear para ver si es estructura JSON
        body_data = json.loads(raw_body.replace("'", '"'))
        is_json = True
    except:
        # Si falla, es string plano/raw data
        is_json = False

# --- 4. EJECUCIÓN ---
result_data = None
try:
    if is_json:
        # requests.post con 'json=' añade auto Content-Type: application/json
        response = requests.post(url, params=params, json=body_data, headers=headers, timeout=30)
    else:
        # Se envía como x-www-form-urlencoded o raw string
        response = requests.post(url, params=params, data=body_data, headers=headers, timeout=30)
    
    try:
        result_data = response.json()
    except:
        result_data = response.text
except Exception as e:
    result_data = {"error": str(e)}

# --- 5. GUARDADO ---
if target_var:
    self.conector.variables[target_var] = result_data
$body$
),

(
    'try', 
    '[]',
    $body$
# Incrementamos el nivel de protección
self.conector.try_level += 1
print(f"[AVAP] Bloque TRY iniciado. Nivel actual: {self.conector.try_level}")
$body$
),

(
    'exception', 
    '[{"item":"error","type":"var"}]',
    $body$
# 1. Obtener el error guardado por el executor
error_msg = self.conector.variables.get('__last_error__', 'No error detected')

# 2. Caso: var = exception(...) -> target es la variable de la izquierda
target = task.get("context")
if target:
    self.conector.variables[target] = error_msg

# 3. Caso: exception(mi_var) -> properties['error'] es el nombre de la variable
# Nota: tu parser guarda los argumentos en task['properties'] (lista o dict)
props = task.get("properties", {})
# Intentamos obtener el nombre de la variable del primer argumento
param_var_name = props.get("error") or props.get("0") or (props[0] if isinstance(props, list) and props else None)

if param_var_name and isinstance(param_var_name, str):
    self.conector.variables[param_var_name] = error_msg

# 4. Limpieza de seguridad
self.conector.try_level -= 1
# self.conector.variables['__last_error__'] = None 
$body$
),
(
    'randomString',
    '[{"item":"Pattern","type":"var"},{"item":"Length","type":"var"},{"item":"TargetVariable","type":"var"}]',
    $body$
Pattern = task["properties"]["Pattern"]
Length = task["properties"]["Length"]

if Pattern in self.conector.variables:
    Pattern = self.conector.variables[Pattern]
elif Pattern in locals():
    Pattern = locals()[Pattern]

TargetVariable = task["properties"]["TargetVariable"].strip()

result_string = ""
for i in range(0, int(Length)):
    result_string += exrex.getone(Pattern)

self.conector.variables[TargetVariable] = result_string
$body$
),
(
    'encodeSHA256',
    '[{"item":"SourceVariable","type":"var"},{"item":"TargetVariable","type":"var"}]',
    $body$
from hashlib import sha256

props = task["properties"]

SourceVariable = props.get("SourceVariable") or next(iter(props.values()), None)
TargetVariable = props.get("TargetVariable") or (list(props.values())[1] if len(props) > 1 else None)

SourceVariable = str(SourceVariable).strip()
TargetVariable = str(TargetVariable).strip()

if SourceVariable in self.conector.variables:
    __Var = self.conector.variables[SourceVariable]
elif SourceVariable in self.conector.local_vars:
    __Var = self.conector.local_vars[SourceVariable]
else:
    __Var = SourceVariable

self.conector.variables[TargetVariable] = sha256(__Var.encode('utf-8')).hexdigest()
$body$
),
(
    'encodeMD5',
    '[{"item":"SourceVariable","type":"var"},{"item":"TargetVariable","type":"var"}]',
    $body$
import hashlib
import re
import os

try:
    __DEBUG = os.getenv("DEBUG")
    if __DEBUG == "True": __DEBUG = True
except:
    __DEBUG = True

props = task["properties"]

SourceVariable = props.get("SourceVariable") or next(iter(props.values()), None)
TargetVariable = props.get("TargetVariable") or (list(props.values())[1] if len(props) > 1 else None)

SourceVariable = str(SourceVariable).strip()
TargetVariable = str(TargetVariable).strip()

try:
    if SourceVariable.strip()[0] == '`' and SourceVariable.strip()[-1] == '`':
        SourceVariable = SourceVariable.replace('`', '')
        __variables_cadena = re.findall('\${([^}]*)}', SourceVariable)
        for __varia in __variables_cadena:
            if __varia in self.conector.variables:
                kert = "${%s}" % __varia
                SourceVariable = SourceVariable.replace(kert, self.conector.variables[__varia])
            elif __varia in self.conector.local_vars:
                kert = "${%s}" % __varia
                SourceVariable = SourceVariable.replace(kert, self.conector.local_vars[__varia])
            else:
                SourceVariable = SourceVariable.replace(kert, '')
except:
    pass

if __DEBUG == True: print("[AVAP] MD5 SourceVariable %s" % SourceVariable)
if __DEBUG == True: print("[AVAP] MD5 TargetVariable %s" % TargetVariable)

encoder = hashlib.md5()
encoder.update(SourceVariable.encode('utf-8'))

if __DEBUG == True: print("[AVAP] MD5 HexDigest %s" % encoder.hexdigest())

self.conector.variables[TargetVariable] = encoder.hexdigest()
$body$
),
(
    'replace',
    '[{"item":"SourceVariable","type":"variable"},{"item":"rePattern","type":"variable"},{"item":"newValue","type":"variable"},{"item":"TargetVariable","type":"variable"}]',
    $body$
import re

props = task["properties"]

SourceVariable = props.get("SourceVariable") or next(iter(props.values()), None)
rePattern      = props.get("rePattern")      or (list(props.values())[1] if len(props) > 1 else None)
newValue       = props.get("newValue")       or (list(props.values())[2] if len(props) > 2 else None)
TargetVariable = props.get("TargetVariable") or (list(props.values())[3] if len(props) > 3 else None)

SourceVariable = str(SourceVariable).strip()
rePattern      = str(rePattern).strip()
newValue       = str(newValue).strip()
TargetVariable = str(TargetVariable).strip()

if SourceVariable in self.conector.variables:
    SourceVariable = self.conector.variables[SourceVariable]
if rePattern in self.conector.variables:
    rePattern = self.conector.variables[rePattern]
if newValue in self.conector.variables:
    newValue = self.conector.variables[newValue]

patron = r"" + rePattern

try:
    result = re.sub(patron, newValue, SourceVariable)
except re.error as e:
    print(f"[AVAP] replace - Error en el patrón: {e}")
    result = ""

self.conector.variables[TargetVariable] = result.replace('¨', '"')
$body$
)
;
