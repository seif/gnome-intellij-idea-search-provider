#!/usr/bin/env python3
# Copyright 2019 Sebastian Wiesner <sebastian@swsnr.de>
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not
# use this file except in compliance with the License. You may obtain a copy of
# the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
# WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
# License for the specific language governing permissions and limitations under
# the License.


import xml.etree.ElementTree as etree
import json
from pathlib import Path


def find_latest_recent_solutions_file():
    """
    Find the `recentSolutions.xml` file of the most recent Rider version.
    """
    candidates = sorted(
        Path.home().glob('.Rider*'),
        key=lambda p: p.name,
        reverse=True)
    if candidates:
        return candidates[0] / 'config' / 'options' / 'recentSolutions.xml'
    else:
        return None


def get_solution(solutionfile):
    """
    Get the solution in the given directory.

    Figure out the solution name, and return a dictionary with the solution name,
    the readable solution path, the absolute solution path, and a unique ID.
    """
    try:
        name = solutionfile.read_text(encoding='utf-8').strip()
    except FileNotFoundError:
        name = str(solutionfile)
    # When changing this object change the `Solution` interface in extension.ts
    return {
        # Conveniently use the absolute path as ID, because it's definitely unique,
        # and prefix it with the name of this launch to avoid conflicts with IDs
        # from other providers.
        'id': 'intellij-rider-search-provider-{0}'.format(solutionfile.expanduser()),
        'name': name,
        'path': str(solutionfile),
        'abspath': str(solutionfile.expanduser())
    }


def find_recent_solutions(recent_solutions_file):
    """
    Find all recent solutions listed in the given recent solutions XML file.
    """
    document = etree.parse(recent_solutions_file)
    paths = (Path(el.attrib['value'].replace('$USER_HOME$', '~'))
             for el in
             document.findall('.//option[@name="recentPaths"]/list/option'))
    solutions = (get_solution(solutionfile) for solutionfile in paths if
                solutionfile.expanduser().is_file())
    return dict((solution['id'], solution) for solution in solutions)


def main():
    print(json.dumps(find_recent_solutions(find_latest_recent_solutions_file())))


if __name__ == '__main__':
    main()
