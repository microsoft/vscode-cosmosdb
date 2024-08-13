export const StatsTab = () => {
    return (
        <div role="tabpanel" aria-labelledby="Stats">
            <table>
                <thead>
                    <th>Destination</th>
                    <th>Gate</th>
                    <th>ETD</th>
                </thead>
                <tbody>
                    <tr>
                        <td>MSP</td>
                        <td>A7</td>
                        <td>8:26 AM</td>
                    </tr>
                    <tr>
                        <td>DCA</td>
                        <td>N2</td>
                        <td>9:03 AM</td>
                    </tr>
                    <tr>
                        <td>LAS</td>
                        <td>E15</td>
                        <td>2:36 PM</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
};
