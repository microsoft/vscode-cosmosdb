export const ResultTab = () => {
    return (
        <div role="tabpanel" aria-labelledby="Result">
            <table>
                <thead>
                    <th>Origin</th>
                    <th>Gate</th>
                    <th>ETA</th>
                </thead>
                <tbody>
                    <tr>
                        <td>DEN</td>
                        <td>C3</td>
                        <td>12:40 PM</td>
                    </tr>
                    <tr>
                        <td>SMF</td>
                        <td>D1</td>
                        <td>1:18 PM</td>
                    </tr>
                    <tr>
                        <td>SFO</td>
                        <td>E18</td>
                        <td>1:42 PM</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
};
