"""Download pinned flybody physical assets without installing its RL controllers."""
import argparse,hashlib,json,tarfile,tempfile,urllib.request
from pathlib import Path
COMMIT='d015e9bfe441bd90ae431bac24c55cb74bdbce26'
URL=f'https://codeload.github.com/TuragaLab/flybody/tar.gz/{COMMIT}'
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path('cloud/assets/flybody'))
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        archive=Path(temporary)/'source.tar.gz';urllib.request.urlretrieve(URL,archive)
        files={}
        with tarfile.open(archive) as tar:
            for member in tar:
                prefix=f'flybody-{COMMIT}/flybody/fruitfly/assets/'
                if member.name==f'flybody-{COMMIT}/LICENSE':name='LICENSE'
                elif member.name.startswith(prefix):name=member.name[len(prefix):]
                else:continue
                if not member.isfile() or '/' in name or name in ('','..') or member.size>32*1024*1024:continue
                data=tar.extractfile(member).read();(args.output/name).write_bytes(data)
                files[name]=hashlib.sha256(data).hexdigest()
        if 'fruitfly.xml' not in files or 'LICENSE' not in files:raise ValueError('Incomplete body archive')
        (args.output/'manifest.json').write_text(json.dumps({'source':'https://github.com/TuragaLab/flybody','commit':COMMIT,'license':'Apache-2.0','files':files},indent=2)+'\n')
    print(json.dumps({'assets':len(files),'commit':COMMIT}))
if __name__=='__main__':main()
