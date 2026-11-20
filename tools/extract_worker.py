"""Extract the Web Worker that vosk.js embeds as base64 into its own file.

vosk-browser starts its worker from a blob: URL. Chrome extension pages (Manifest V3)
are not allowed to run blob: workers, so the listener page loads this extracted copy
instead. Re-run after replacing extension/vendor/vosk.js:

    python tools/extract_worker.py
    python tools/extract_worker.py --dest X   # read and write X/vendor instead of extension/vendor
"""
import argparse
import base64
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--dest", default=str(root / "extension"))
vendor = pathlib.Path(parser.parse_args().dest).resolve() / "vendor"
src = (vendor / "vosk.js").read_text(encoding="utf-8")

match = re.search(r"createBase64WorkerFactory\('([A-Za-z0-9+/=]+)'", src)
if not match:
    raise SystemExit("worker base64 not found in vosk.js")

code = base64.b64decode(match.group(1)).decode("latin-1")
# vosk.js drops the first line (a loader comment) before building the blob; do the same.
code = code[code.index("\n", 10) + 1:]

# The worker builds one helper with `new Function`, which extension pages forbid
# (no 'unsafe-eval'). Swap it for the eval-free equivalent.
evalish = re.compile(
    r"function createNamedFunction\(name,body\)\{name=makeLegalFunctionName\(name\);"
    r"return new Function\(.*?\)\(body\)\}",
    re.S,
)
code, count = evalish.subn(
    "function createNamedFunction(name,body){name=makeLegalFunctionName(name);"
    "return {[name]:function(){return body.apply(this,arguments)}}[name]}",
    code,
)
if count != 1 or "new Function" in code:
    raise SystemExit("could not patch createNamedFunction; vosk.js layout changed")

# Two more embind helpers generate code from strings via new_(Function, ...). Replace each
# whole function with the closure-based version emscripten itself uses when built without
# dynamic execution. These replacements are adapted from Emscripten (MIT license); see
# THIRD-PARTY-NOTICES.md.
CRAFT_INVOKER = """function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
var argCount=argTypes.length;
if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");}
var isClassMethodFunc=argTypes[1]!==null&&classType!==null;
var needsDestructorStack=false;
for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}
var returns=argTypes[0].name!=="void";
var expectedArgCount=argCount-2;
return function(){
if(arguments.length!==expectedArgCount){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expectedArgCount+" args!");}
var destructors=needsDestructorStack?[]:null;
var argsWired=new Array(expectedArgCount);
var invokerArgs=[cppTargetFunc];
var thisWired;
if(isClassMethodFunc){thisWired=argTypes[1].toWireType(destructors,this);invokerArgs.push(thisWired);}
for(var i=0;i<expectedArgCount;++i){argsWired[i]=argTypes[i+2].toWireType(destructors,arguments[i]);invokerArgs.push(argsWired[i]);}
var rv=cppInvokerFunc.apply(null,invokerArgs);
if(needsDestructorStack){runDestructors(destructors);}
else{for(var j=isClassMethodFunc?1:2;j<argTypes.length;++j){var param=j===1?thisWired:argsWired[j-2];if(argTypes[j].destructorFunction!==null){argTypes[j].destructorFunction(param);}}}
if(returns){return argTypes[0].fromWireType(rv);}
};
}"""

METHOD_CALLER = """function __emval_get_method_caller(argCount,argTypes){
var types=__emval_lookupTypes(argCount,argTypes);
var retType=types[0];
var invokerFunction=function(handle,name,destructors,args){
var argN=new Array(argCount-1);
var offset=0;
for(var i=0;i<argCount-1;++i){argN[i]=types[i+1].readValueFromPointer(args+offset);offset+=types[i+1]["argPackAdvance"];}
var rv=handle[name].apply(handle,argN);
for(var i=0;i<argCount-1;++i){if(types[i+1]["deleteObject"]){types[i+1].deleteObject(argN[i]);}}
if(!retType.isVoid){return retType.toWireType(destructors,rv);}
};
return __emval_addMethodCaller(invokerFunction)}"""


def replace_function(text, start_marker, end_marker, replacement):
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[:start] + replacement + text[end:]


code = replace_function(
    code, "function craftInvokerFunction(", "function heap32VectorToArray(", CRAFT_INVOKER
)
code = replace_function(
    code, "function __emval_get_method_caller(", "function __emval_incref(", METHOD_CALLER
)
if "new_(Function" in code:
    raise SystemExit("string-built functions remain in the worker; vosk.js layout changed")

out = vendor / "vosk-worker.js"
out.write_text(code, encoding="latin-1", newline="")
print(f"wrote {out} ({out.stat().st_size} bytes)")
